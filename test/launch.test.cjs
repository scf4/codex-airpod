"use strict";

const assert = require("node:assert/strict");
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, test } = require("node:test");
const {
  INTERNAL_RELAUNCH_ARGUMENT,
  createEnvironment,
  parseArguments,
  waitForChatGPTExit,
  withDisabledFeature,
} = require("../src/launch.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const projectRoot = path.join(__dirname, "..");
const launchCommandPath = path.join(projectRoot, "launch.command");
const launchCommandSource = readFileSync(launchCommandPath, "utf8");
const launchSource = readFileSync(
  path.join(projectRoot, "src", "launch.cjs"),
  "utf8",
);

function withTemporaryDirectory(callback) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codex-airpod-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function writeExecutable(filePath, source) {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}

function runSourcedCommand(command, argumentsList = [], options = {}) {
  const shellArguments = [
    "-c",
    `source "$1"; ${command}`,
    "zsh",
    launchCommandPath,
    ...argumentsList,
  ];
  return spawnSync(
    "/bin/zsh",
    shellArguments,
    {
      encoding: "utf8",
      ...options,
    },
  );
}

describe("launch arguments and environment", () => {
  test("adds the in-process audio feature kill switch", () => {
    assert.deepEqual(parseArguments([]), {
      checkOnly: false,
      quitRunning: false,
      appArguments: [
        `--disable-features=${AUDIO_SERVICE_FEATURE}`,
      ],
    });
  });

  test("merges feature flags without duplication", () => {
    assert.deepEqual(
      withDisabledFeature(
        ["--disable-features=OtherFeature"],
        AUDIO_SERVICE_FEATURE,
      ),
      [
        `--disable-features=OtherFeature,${AUDIO_SERVICE_FEATURE}`,
      ],
    );
    assert.deepEqual(
      withDisabledFeature(
        [`--disable-features=${AUDIO_SERVICE_FEATURE}`],
        AUDIO_SERVICE_FEATURE,
      ),
      [`--disable-features=${AUDIO_SERVICE_FEATURE}`],
    );
  });

  test("rejects conflicting out-of-process audio enablement", () => {
    assert.throws(
      () =>
        parseArguments([
          `--enable-features=${AUDIO_SERVICE_FEATURE}`,
        ]),
      /Cannot enable/,
    );
  });

  test("strips the internal relaunch argument", () => {
    assert.deepEqual(
      parseArguments([INTERNAL_RELAUNCH_ARGUMENT, "--example"]),
      {
        checkOnly: false,
        quitRunning: true,
        appArguments: [
          "--example",
          `--disable-features=${AUDIO_SERVICE_FEATURE}`,
        ],
      },
    );
    assert.throws(
      () =>
        parseArguments([
          INTERNAL_RELAUNCH_ARGUMENT,
          "--check",
        ]),
      /cannot be combined/,
    );
  });

  test("isolates the per-launch environment", () => {
    const environment = createEnvironment(
      {
        NODE_OPTIONS: "--require=/tmp/other.cjs",
        ELECTRON_RUN_AS_NODE: "1",
        KEEP_ME: "yes",
      },
      {
        preloadPath: "/safe/preload.cjs",
      },
    );

    assert.equal(
      environment.NODE_OPTIONS,
      '--require="/safe/preload.cjs"',
    );
    assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(environment.KEEP_ME, "yes");
  });
});

describe("normal ChatGPT quit", () => {
  test("waits for the running process to disappear", async () => {
    let checks = 0;
    let elapsed = 0;
    const sleeps = [];

    await waitForChatGPTExit({
      findRunning: async () => {
        checks += 1;
        return checks < 3 ? [{ pid: 42 }] : [];
      },
      now: () => elapsed,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        elapsed += milliseconds;
      },
      timeoutMs: 1_000,
      pollIntervalMs: 250,
    });

    assert.equal(checks, 3);
    assert.deepEqual(sleeps, [250, 250]);
  });

  test("stops waiting after the ten-second deadline", async () => {
    let elapsed = 0;

    await assert.rejects(
      waitForChatGPTExit({
        findRunning: async () => [{ pid: 42 }],
        now: () => elapsed,
        sleep: async (milliseconds) => {
          elapsed += milliseconds;
        },
        timeoutMs: 10_000,
        pollIntervalMs: 1_000,
      }),
      /did not quit within 10 seconds/,
    );
    assert.equal(elapsed, 10_000);
  });

  test("checks trust before the internal quit path", () => {
    const mainSource = launchSource.slice(
      launchSource.indexOf("async function main"),
    );
    const trustCheck = mainSource.indexOf("await verifySignature()");
    const quitRequest = mainSource.indexOf("await requestChatGPTQuit()");
    assert.notEqual(trustCheck, -1);
    assert.notEqual(quitRequest, -1);
    assert.ok(trustCheck < quitRequest);
    assert.match(
      launchSource,
      /tell application id "\$\{PROFILE\.appIdentifier\}" to quit/,
    );
    assert.doesNotMatch(launchSource, /kill\(|SIGKILL|force quit/i);
  });
});

describe("Finder launch command", () => {
  test("selects the first Node 20-or-newer candidate", () => {
    withTemporaryDirectory((directory) => {
      const oldNode = path.join(directory, "node-old");
      const currentNode = path.join(directory, "node-current");
      writeExecutable(oldNode, "#!/bin/sh\nprintf '18\\n'\n");
      writeExecutable(currentNode, "#!/bin/sh\nprintf '22\\n'\n");

      const result = runSourcedCommand(
        'select_supported_node "$2" "$3"',
        [oldNode, currentNode],
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), currentNode);
    });
  });

  test("Return retries through the internal quit-and-relaunch path", () => {
    withTemporaryDirectory((directory) => {
      const fakeNode = path.join(directory, "node");
      const callsPath = path.join(directory, "calls");
      writeExecutable(
        fakeNode,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$CALLS_PATH"',
          'case " $* " in',
          '  *" --quit-running "*) exit 0 ;;',
          "  *) printf 'already running\\n' >&2; exit 2 ;;",
          "esac",
          "",
        ].join("\n"),
      );

      const result = runSourcedCommand(
        'run_finder_launcher "$2" "$3"',
        [fakeNode, projectRoot],
        {
          env: { ...process.env, CALLS_PATH: callsPath },
          input: "\n",
        },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout,
        "ChatGPT is already running. Press Return to quit and relaunch it, or any other key to cancel.\n",
      );
      const calls = readFileSync(callsPath, "utf8")
        .trim()
        .split("\n");
      assert.equal(calls.length, 2);
      assert.doesNotMatch(calls[0], /--quit-running/);
      assert.match(calls[1], /--quit-running/);
    });
  });

  test("any other key cancels cleanly", () => {
    withTemporaryDirectory((directory) => {
      const fakeNode = path.join(directory, "node");
      const callsPath = path.join(directory, "calls");
      writeExecutable(
        fakeNode,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$CALLS_PATH"',
          "exit 2",
          "",
        ].join("\n"),
      );

      const result = runSourcedCommand(
        'run_finder_launcher "$2" "$3"',
        [fakeNode, projectRoot],
        {
          env: { ...process.env, CALLS_PATH: callsPath },
          input: "x",
        },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout,
        "ChatGPT is already running. Press Return to quit and relaunch it, or any other key to cancel.\n",
      );
      assert.equal(
        readFileSync(callsPath, "utf8").trim().split("\n").length,
        1,
      );
    });
  });

  test("check mode stays noninteractive when ChatGPT is running", () => {
    withTemporaryDirectory((directory) => {
      const fakeNode = path.join(directory, "node");
      const callsPath = path.join(directory, "calls");
      writeExecutable(
        fakeNode,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$CALLS_PATH"',
          "printf 'already running\\n' >&2",
          "exit 2",
          "",
        ].join("\n"),
      );

      const result = runSourcedCommand(
        'run_finder_launcher "$2" "$3" "$4"',
        [fakeNode, projectRoot, "--check"],
        {
          env: { ...process.env, CALLS_PATH: callsPath },
          input: "\n",
        },
      );

      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "already running\n");
      assert.equal(
        readFileSync(callsPath, "utf8").trim().split("\n").length,
        1,
      );
    });
  });

  test("does not force-close Terminal", () => {
    assert.doesNotMatch(
      launchCommandSource,
      /close (?:the )?(?:front )?window|quit application ["']Terminal/i,
    );
  });
});

describe("runtime architecture and forbidden behavior", () => {
  const sourceDirectory = path.join(projectRoot, "src");
  const sources = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => ({
      name,
      source: readFileSync(path.join(sourceDirectory, name), "utf8"),
    }));
  const allSource = sources
    .map(({ source }) => source)
    .join("\n");

  test("uses four responsibility-based runtime files", () => {
    assert.deepEqual(
      sources.map(({ name }) => name).sort(),
      [
        "airpods.cjs",
        "launch.cjs",
        "preload.cjs",
        "transforms.cjs",
      ],
    );
  });

  test("contains no process/system mute or capture-stop path", () => {
    for (const forbidden of [
      "AudioObjectSetPropertyData",
      "CoreAudio.framework",
      "pmin",
      "voiceProcessingInputMuted",
      "stopCapture",
      "stopRecording",
      "setProcessInputMuted",
      "setApplicationInputMuted",
    ]) {
      assert.equal(
        allSource.includes(forbidden),
        false,
        `forbidden runtime path: ${forbidden}`,
      );
    }
  });

  test("confines AVAudioApplication mute state to the native adapter", () => {
    const nativeSource = sources.find(
      ({ name }) => name === "airpods.cjs",
    )?.source;
    assert.equal(typeof nativeSource, "string");
    assert.equal(nativeSource.includes("isInputMuted"), true);
    assert.equal(nativeSource.includes("setInputMuted$error$"), true);

    for (const { name, source } of sources) {
      if (name === "airpods.cjs") continue;
      assert.equal(
        /\bisInputMuted\b|setInputMuted\$error\$/.test(source),
        false,
        `AVAudioApplication mute access escaped native adapter: ${name}`,
      );
    }
  });

  test("contains one exact-state command and no secondary mute owner", () => {
    assert.equal(
      allSource.split('type: "set-microphone-muted"').length - 1,
      1,
    );
    assert.equal(allSource.includes("toggle-microphone-mute"), false);
    assert.equal(allSource.includes("controlActive("), false);
    assert.equal(allSource.includes("writeFileSync"), false);
  });

  test("has no network client or app-bundle write primitive", () => {
    for (const forbidden of [
      "fetch(",
      "https.request",
      "http.request",
      "WebSocket",
      "app.asar.unpacked",
    ]) {
      assert.equal(allSource.includes(forbidden), false);
    }
  });
});
