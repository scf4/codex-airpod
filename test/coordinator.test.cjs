"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  installCoordinatorCapture,
} = require("../src/coordinator.cjs");

const CAPTURE_SYMBOL = Symbol.for(
  "airpods-codex-mute.voice-coordinator.v1",
);

function targetFilename() {
  return "/Applications/ChatGPT.app/Contents/Resources/app.asar/.vite/build/main-fixture.js";
}

test("compile hook patches once, restores stock hook, and captures coordinator", () => {
  const globalObject = {};
  const compiled = [];
  const coordinator = {
    getSnapshot() {},
    control() {},
    controlActive() {},
  };
  function FakeModule() {}
  const original = function (source, filename) {
    compiled.push({
      source,
      filename,
      restored: FakeModule.prototype._compile === original,
    });
    globalObject[CAPTURE_SYMBOL]?.(coordinator);
    return "compiled";
  };
  FakeModule.prototype._compile = original;

  const capture = installCoordinatorCapture({
    moduleApi: FakeModule,
    globalObject,
    patchSource: () => ({ ok: true, source: "patched" }),
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
  });

  assert.equal(
    new FakeModule()._compile("stock", targetFilename()),
    "compiled",
  );
  assert.deepEqual(compiled, [
    {
      source: "patched",
      filename: targetFilename(),
      restored: true,
    },
  ]);
  assert.equal(capture.getCoordinator(), coordinator);
  assert.equal(capture.getStatus(), "captured");
  assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
});

test("patch rejection compiles byte-identical stock source", () => {
  const globalObject = {};
  const compiled = [];
  function FakeModule() {}
  const original = function (source) {
    compiled.push(source);
    return source;
  };
  FakeModule.prototype._compile = original;
  const capture = installCoordinatorCapture({
    moduleApi: FakeModule,
    globalObject,
    patchSource: (source) => ({
      ok: false,
      reason: "test-drift",
      source,
    }),
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
  });

  assert.equal(
    new FakeModule()._compile("stock bytes", targetFilename()),
    "stock bytes",
  );
  assert.deepEqual(compiled, ["stock bytes"]);
  assert.equal(capture.getStatus(), "failed");
  assert.equal(FakeModule.prototype._compile, original);
});

test("capture timeout removes the hook and capture slot", () => {
  const globalObject = {};
  let timeout;
  function FakeModule() {}
  const original = function () {};
  FakeModule.prototype._compile = original;
  const failures = [];
  const capture = installCoordinatorCapture({
    moduleApi: FakeModule,
    globalObject,
    setTimeoutFn: (callback) => {
      timeout = callback;
      return { unref() {} };
    },
    clearTimeoutFn: () => {},
  });
  capture.onFailure((reason) => failures.push(reason));

  timeout();
  assert.equal(capture.getStatus(), "failed");
  assert.equal(FakeModule.prototype._compile, original);
  assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
  assert.deepEqual(failures, ["capture-timeout"]);
});

test("partial hook installation rolls back completely", () => {
  const globalObject = {};
  function FakeModule() {}
  const original = function () {};
  FakeModule.prototype._compile = original;
  Object.preventExtensions(FakeModule.prototype);

  assert.throws(() =>
    installCoordinatorCapture({
      moduleApi: FakeModule,
      globalObject,
      setTimeoutFn: () => ({ unref() {} }),
      clearTimeoutFn: () => {},
    }),
  );
  assert.equal(FakeModule.prototype._compile, original);
  assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
});
