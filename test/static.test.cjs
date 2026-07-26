"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceDirectory = path.join(__dirname, "..", "src");
const sources = fs
  .readdirSync(sourceDirectory)
  .filter((name) => name.endsWith(".cjs"))
  .map((name) => ({
    name,
    source: fs.readFileSync(
      path.join(sourceDirectory, name),
      "utf8",
    ),
  }));
const allSource = sources
  .map(({ source }) => source)
  .join("\n");

test("runtime contains no process/system mute or capture-stop path", () => {
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

test("AVAudioApplication mute state is confined to the native adapter", () => {
  const nativeSource = sources.find(
    ({ name }) => name === "native-gesture.cjs",
  )?.source;
  assert.equal(typeof nativeSource, "string");
  assert.equal(nativeSource.includes("isInputMuted"), true);
  assert.equal(nativeSource.includes("setInputMuted$error$"), true);

  for (const { name, source } of sources) {
    if (name === "native-gesture.cjs") continue;
    assert.equal(
      /\bisInputMuted\b|setInputMuted\$error\$/.test(source),
      false,
      `AVAudioApplication mute access escaped native adapter: ${name}`,
    );
  }
});

test("runtime contains one canonical exact-state command and no blind toggle", () => {
  assert.equal(
    allSource.split('type: "set-microphone-muted"').length - 1,
    1,
  );
  assert.equal(
    allSource.includes("toggle-microphone-mute"),
    false,
  );
  assert.equal(allSource.includes("controlActive("), false);
  assert.equal(allSource.includes("writeFileSync"), false);
});

test("package has no network client or app-bundle write primitive", () => {
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
