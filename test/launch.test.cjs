"use strict";

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { describe, test } = require("node:test");
const {
  createEnvironment,
  parseArguments,
  withDisabledFeature,
} = require("../src/launch.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const projectRoot = path.join(__dirname, "..");

describe("launch arguments and environment", () => {
  test("adds the in-process audio feature kill switch", () => {
    assert.deepEqual(parseArguments([]), {
      checkOnly: false,
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
