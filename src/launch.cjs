"use strict";

const { spawn, execFile } = require("node:child_process");
const { lstat } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const {
  PROFILE,
  appPaths,
} = require("./build-profile.cjs");

const execFileAsync = promisify(execFile);
const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const RUNTIME_FILES = [
  "build-profile.cjs",
  "coordinator.cjs",
  "lifecycle.cjs",
  "native-gesture.cjs",
  "preload.cjs",
  "renderer.cjs",
];

function hasFeature(argumentsList, switchName, feature) {
  return argumentsList.some((argument) => {
    if (
      typeof argument !== "string" ||
      !argument.startsWith(`--${switchName}=`)
    ) {
      return false;
    }
    return argument
      .slice(`--${switchName}=`.length)
      .split(",")
      .map((item) => item.trim())
      .includes(feature);
  });
}

function withDisabledFeature(argumentsList, feature) {
  let merged = false;
  const result = argumentsList.map((argument) => {
    if (
      typeof argument !== "string" ||
      !argument.startsWith("--disable-features=")
    ) {
      return argument;
    }
    merged = true;
    const features = argument
      .slice("--disable-features=".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!features.includes(feature)) features.push(feature);
    return `--disable-features=${features.join(",")}`;
  });
  if (!merged) result.push(`--disable-features=${feature}`);
  return result;
}

function parseArguments(argumentsList) {
  const checkOnly = argumentsList.includes("--check");
  const forwarded = argumentsList.filter(
    (argument) => argument !== "--check",
  );
  if (
    hasFeature(
      forwarded,
      "enable-features",
      AUDIO_SERVICE_FEATURE,
    )
  ) {
    throw new Error(
      `Cannot enable ${AUDIO_SERVICE_FEATURE} in AirPods mute mode`,
    );
  }
  return {
    checkOnly,
    appArguments: withDisabledFeature(
      forwarded,
      AUDIO_SERVICE_FEATURE,
    ),
  };
}

function createEnvironment(base, { preloadPath }) {
  const environment = { ...base };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.NODE_OPTIONS =
    `--require=${JSON.stringify(preloadPath)}`;
  return environment;
}

async function assertSafeRuntimeFile(filePath) {
  const info = await lstat(filePath);
  const uid = process.getuid?.();
  if (
    !info.isFile() ||
    (uid !== undefined && info.uid !== uid) ||
    (info.mode & 0o022) !== 0
  ) {
    throw new Error(`Unsafe runtime file: ${filePath}`);
  }
}

async function verifyRuntimeFiles(sourceDirectory) {
  await Promise.all(
    RUNTIME_FILES.map((name) =>
      assertSafeRuntimeFile(path.join(sourceDirectory, name)),
    ),
  );
}

async function verifyExecutable(executable) {
  const info = await lstat(executable);
  if (
    !info.isFile() ||
    (info.mode & 0o111) === 0
  ) {
    throw new Error(`ChatGPT executable not found: ${executable}`);
  }
}

async function verifySignature(profile = PROFILE) {
  await execFileAsync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    profile.appPath,
  ]);
  const { stderr } = await execFileAsync("/usr/bin/codesign", [
    "-d",
    "--verbose=4",
    profile.appPath,
  ]);
  if (
    !stderr.includes(`Identifier=${profile.appIdentifier}`) ||
    !stderr.includes(`TeamIdentifier=${profile.appTeamIdentifier}`) ||
    !stderr.includes("flags=0x10000(runtime)")
  ) {
    throw new Error("ChatGPT is not the expected signed OpenAI app");
  }
}

async function findRunningChatGPT() {
  const { stdout } = await execFileAsync("/bin/ps", [
    "-axo",
    "pid=,command=",
  ]);
  const matches = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (
      match &&
      /^\/Applications\/ChatGPT(?:-[^/]+)?\.app\/Contents\/MacOS\/ChatGPT(?:\s|$)/.test(
        match[2],
      )
    ) {
      matches.push({
        pid: Number(match[1]),
        command: match[2],
      });
    }
  }
  return matches;
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function main(argumentsList = process.argv.slice(2)) {
  if (process.platform !== "darwin") {
    throw new Error("This launcher supports macOS only");
  }
  if (Number(process.versions.node.split(".")[0]) < 20) {
    throw new Error("Node.js 20 or newer is required");
  }

  const { appArguments, checkOnly } =
    parseArguments(argumentsList);
  const sourceDirectory = __dirname;
  const preloadPath = path.join(sourceDirectory, "preload.cjs");
  const paths = appPaths();

  await verifyRuntimeFiles(sourceDirectory);
  await verifyExecutable(paths.executable);
  await verifySignature();

  const running = await findRunningChatGPT();
  if (running.length > 0) {
    const error = new Error(
      `ChatGPT is already running (PID ${running
        .map(({ pid }) => pid)
        .join(", ")}). Quit it completely first.`,
    );
    error.exitCode = 2;
    throw error;
  }

  if (checkOnly) {
    process.stdout.write("Ready for signed stock ChatGPT.\n");
    return;
  }

  const child = spawn(paths.executable, appArguments, {
    detached: true,
    env: createEnvironment(process.env, {
      preloadPath,
    }),
    stdio: "ignore",
  });
  await waitForSpawn(child);
  child.unref();

  process.stdout.write(
    [
      "Launched signed stock ChatGPT with AirPods Codex mute control.",
      "Launch ChatGPT normally next time to revert.",
      "",
    ].join("\n"),
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode =
      Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  });
}

module.exports = {
  createEnvironment,
  parseArguments,
  withDisabledFeature,
};
