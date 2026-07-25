"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isMainBundle,
  patchMainSource,
} = require("../src/build-profile.cjs");

function coordinatorSource({
  continuity = "a",
  memory = "b",
  presentation = "c",
  history = "d",
  activity = "e",
  voice = "f",
  prefix = "before;",
} = {}) {
  return (
    prefix +
    `this.realtime={continuity:${continuity},memory:${memory},presentation:${presentation}.rpc,voiceHistory:${history},multiAgentActivity:${activity},voice:${voice}.rpc},this.disposables.add(${presentation}.dispose);after`
  );
}

function mainBundle(name = "main-fixture.js") {
  return `/Applications/ChatGPT.app/Contents/Resources/app.asar/.vite/build/${name}`;
}

test("structural source patch tolerates new bundle names and identifiers", () => {
  for (const [source, filename] of [
    [coordinatorSource(), mainBundle("main-old.js")],
    [
      coordinatorSource({
        continuity: "aa",
        memory: "$b",
        presentation: "_c",
        history: "dd",
        activity: "$$",
        voice: "voice2",
        prefix: "different-build;",
      }),
      mainBundle("main-new-build.js"),
    ],
  ]) {
    const result = patchMainSource(source, filename);
    assert.equal(result.ok, true);
    assert.match(
      result.source,
      /Symbol\.for\("airpods-codex-mute\.voice-coordinator\.v1"\)/,
    );
    assert.match(result.source, /this\.realtime\.voice/);
    assert.equal(source.includes("Symbol.for"), false);
  }
});

test("source patch fails closed on incompatible or ambiguous structure", () => {
  const source = coordinatorSource();
  for (const candidate of [
    ["not JavaScript", mainBundle()],
    [source + source, mainBundle()],
    [source, "/tmp/main-fixture.js"],
  ]) {
    const result = patchMainSource(...candidate);
    assert.equal(result.ok, false);
    assert.equal(result.source, candidate[0]);
  }

  const patched = patchMainSource(source, mainBundle());
  assert.equal(
    patchMainSource(patched.source, mainBundle()).ok,
    false,
  );
});

test("main bundle matcher accepts changing Vite bundle names only", () => {
  assert.equal(isMainBundle(mainBundle("main-a1b2c3.js")), true);
  assert.equal(isMainBundle(mainBundle("main-next.js")), true);
  assert.equal(isMainBundle(mainBundle("worker-next.js")), false);
  assert.equal(isMainBundle("/tmp/main-next.js"), false);
});
