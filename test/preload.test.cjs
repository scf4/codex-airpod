"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  attachToElectron,
  chromiumFeatures,
  observeElectron,
  stripManagedRequire,
} = require("../src/preload.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";

test("preload strips only its managed NODE_OPTIONS require", () => {
  const filename = "/tmp/a path/preload.cjs";
  const managed = `--require=${JSON.stringify(filename)}`;
  assert.equal(stripManagedRequire(managed, filename), undefined);
  assert.equal(
    stripManagedRequire(`--trace-warnings ${managed}`, filename),
    "--trace-warnings",
  );
  assert.equal(
    stripManagedRequire("--require=/tmp/other.cjs", filename),
    "--require=/tmp/other.cjs",
  );
});

test("Electron observer restores Module._load after capture", () => {
  const electron = {
    app: {
      on() {},
      whenReady() {},
    },
  };
  const moduleApi = {
    _load(request) {
      return request === "electron" ? electron : {};
    },
  };
  const original = moduleApi._load;
  let captured;
  assert.equal(
    observeElectron((value) => {
      captured = value;
    }, { moduleApi }),
    true,
  );

  assert.deepEqual(moduleApi._load("other"), {});
  assert.equal(moduleApi._load("electron"), electron);
  assert.equal(captured, electron);
  assert.equal(moduleApi._load, original);
});

test("Electron observer contains attachment exceptions", () => {
  const electron = {
    app: {
      on() {},
      whenReady() {},
    },
  };
  const moduleApi = {
    _load: () => electron,
  };
  const original = moduleApi._load;
  observeElectron(
    () => {
      throw new Error("test attach failure");
    },
    { moduleApi },
  );

  assert.doesNotThrow(() => moduleApi._load("electron"));
  assert.equal(moduleApi._load, original);
});

test("Chromium feature validation includes process arguments", () => {
  const app = {
    commandLine: {
      getSwitchValue: () => "",
    },
  };
  assert.equal(
    chromiumFeatures(app, "disable-features", [
      `--disable-features=Other,${AUDIO_SERVICE_FEATURE}`,
    ]).has(AUDIO_SERVICE_FEATURE),
    true,
  );
});

test("Electron lifecycle composes and cleans up once", async () => {
  const app = new EventEmitter();
  app.commandLine = {
    getSwitchValue(name) {
      return name === "disable-features"
        ? AUDIO_SERVICE_FEATURE
        : "";
    },
  };
  app.getVersion = () => "test";
  app.whenReady = () => Promise.resolve();
  const capture = {
    disposed: 0,
    dispose() {
      this.disposed += 1;
    },
    getCoordinator: () => null,
    getStatus: () => "waiting",
  };
  let nativeDisposed = 0;
  let lifecycleDisposed = 0;
  let lifecycleStarted = 0;

  assert.equal(
    attachToElectron(
      { app },
      capture,
      {
        createNative: async () => ({
          dispose() {
            nativeDisposed += 1;
          },
          register: () => true,
          runtime: { objcJs: "index.js" },
          unregister: () => true,
        }),
        createLifecycle: () => ({
          dispose() {
            lifecycleDisposed += 1;
          },
          handleRequest: () => false,
          start() {
            lifecycleStarted += 1;
          },
        }),
      },
    ),
    true,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycleStarted, 1);
  app.emit("will-quit");
  assert.equal(lifecycleDisposed, 1);
  assert.equal(nativeDisposed, 1);
  assert.equal(capture.disposed, 1);
});

test("capture failure tears down an active native bridge", async () => {
  const app = new EventEmitter();
  app.commandLine = {
    getSwitchValue(name) {
      return name === "disable-features"
        ? AUDIO_SERVICE_FEATURE
        : "";
    },
  };
  app.whenReady = () => Promise.resolve();
  let failCapture;
  const capture = {
    dispose() {},
    getCoordinator: () => null,
    getStatus: () => "waiting",
    onFailure(callback) {
      failCapture = callback;
      return () => {};
    },
  };
  let nativeDisposed = 0;
  let lifecycleDisposed = 0;

  attachToElectron(
    { app },
    capture,
    {
      createNative: async () => ({
        dispose() {
          nativeDisposed += 1;
        },
        register: () => true,
        runtime: {},
        unregister: () => true,
      }),
      createLifecycle: () => ({
        dispose() {
          lifecycleDisposed += 1;
        },
        handleRequest: () => false,
        start() {},
      }),
    },
  );
  await new Promise((resolve) => setImmediate(resolve));

  failCapture("source-mismatch");
  assert.equal(lifecycleDisposed, 1);
  assert.equal(nativeDisposed, 1);
});

test("runtime refuses an out-of-process audio configuration", () => {
  const app = new EventEmitter();
  app.commandLine = {
    getSwitchValue: () => "",
  };
  app.whenReady = () => Promise.resolve();
  let captureDisposed = 0;
  assert.equal(
    attachToElectron(
      { app },
      {
        dispose() {
          captureDisposed += 1;
        },
      },
    ),
    false,
  );
  assert.equal(captureDisposed, 1);
});
