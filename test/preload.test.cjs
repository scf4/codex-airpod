"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { describe, test } = require("node:test");
const {
  createEnvironment,
  parseArguments,
} = require("../src/launch.cjs");
const {
  attachToElectron,
  chromiumFeatures,
  installCoordinatorCapture,
  observeElectron,
  runPreload,
} = require("../src/preload.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const CAPTURE_SYMBOL = Symbol.for(
  "airpods-codex-mute.voice-coordinator.v1",
);

function targetFilename() {
  return "/Applications/ChatGPT.app/Contents/Resources/app.asar/.vite/build/main-fixture.js";
}

describe("Electron integration", () => {
  test("preload clears the launcher-owned NODE_OPTIONS directly", () => {
    const app = new EventEmitter();
    app.commandLine = { getSwitchValue: () => "" };
    app.whenReady = () => Promise.resolve();
    const electron = { app };
    function FakeModule() {}
    FakeModule.prototype._compile = function () {};
    const originalLoad = function (request) {
      return request === "electron" ? electron : {};
    };
    FakeModule._load = originalLoad;
    const previous = process.env.NODE_OPTIONS;

    try {
      process.env.NODE_OPTIONS = "--launcher-owned-value";
      assert.equal(
        runPreload({
          globalObject: {},
          moduleApi: FakeModule,
        }),
        true,
      );
      assert.equal(process.env.NODE_OPTIONS, undefined);
      FakeModule._load("electron");
      assert.equal(FakeModule._load, originalLoad);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
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
    let captures = 0;
    assert.equal(
      observeElectron(() => {
        captures += 1;
      }, { moduleApi }),
      true,
    );

    assert.deepEqual(moduleApi._load("other"), {});
    assert.equal(moduleApi._load("electron"), electron);
    assert.equal(captures, 1);
    assert.equal(moduleApi._load, original);
    assert.equal(moduleApi._load("electron"), electron);
    assert.equal(captures, 1);
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
    };
    let nativeDisposed = 0;
    let lifecycleDisposed = 0;
    let lifecycleStarted = 0;
    let rendererDisposed = 0;

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
              return true;
            },
          }),
          installRenderer: () => ({
            dispose() {
              rendererDisposed += 1;
            },
            ready: Promise.resolve(true),
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
    assert.equal(rendererDisposed, 1);
    assert.equal(capture.disposed, 1);
  });

  test("failed lifecycle startup retires the partial runtime", async () => {
    const app = new EventEmitter();
    app.commandLine = {
      getSwitchValue(name) {
        return name === "disable-features"
          ? AUDIO_SERVICE_FEATURE
          : "";
      },
    };
    app.whenReady = () => Promise.resolve();
    const calls = [];
    const capture = {
      dispose: () => calls.push("capture"),
      getCoordinator: () => null,
    };

    assert.equal(
      attachToElectron(
        { app },
        capture,
        {
          createNative: async () => ({
            dispose: () => calls.push("native"),
          }),
          createLifecycle: () => ({
            dispose: () => calls.push("lifecycle"),
            handleRequest: () => false,
            start: () => false,
          }),
          installRenderer: () => ({
            dispose: () => calls.push("renderer"),
            ready: Promise.resolve(true),
          }),
        },
      ),
      true,
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [
      "lifecycle",
      "native",
      "renderer",
      "capture",
    ]);
  });

  test("quit cleanup contains every teardown failure", async () => {
    const app = new EventEmitter();
    app.commandLine = {
      getSwitchValue(name) {
        return name === "disable-features"
          ? AUDIO_SERVICE_FEATURE
          : "";
      },
    };
    app.whenReady = () => Promise.resolve();
    const calls = [];
    const capture = {
      dispose() {
        calls.push("capture");
        throw new Error("capture teardown");
      },
      getCoordinator: () => null,
    };

    attachToElectron(
      { app },
      capture,
      {
        createNative: async () => ({
          dispose() {
            calls.push("native");
            throw new Error("native teardown");
          },
        }),
        createLifecycle: () => ({
          dispose() {
            calls.push("lifecycle");
            throw new Error("lifecycle teardown");
          },
          handleRequest: () => false,
          start: () => true,
        }),
        installRenderer: () => ({
          dispose() {
            calls.push("renderer");
            throw new Error("renderer teardown");
          },
          ready: Promise.resolve(true),
        }),
      },
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.doesNotThrow(() => app.emit("will-quit"));
    assert.deepEqual(calls, [
      "lifecycle",
      "native",
      "renderer",
      "capture",
    ]);
  });

  test("renderer readiness gates native runtime creation", async () => {
    const app = new EventEmitter();
    app.commandLine = {
      getSwitchValue(name) {
        return name === "disable-features"
          ? AUDIO_SERVICE_FEATURE
          : "";
      },
    };
    app.whenReady = () => Promise.resolve();
    const capture = {
      dispose() {},
      getCoordinator: () => null,
    };
    let resolveRenderer;
    const ready = new Promise((resolve) => {
      resolveRenderer = resolve;
    });
    let nativeCreated = 0;

    attachToElectron(
      { app },
      capture,
      {
        createNative: async () => {
          nativeCreated += 1;
          return {
            dispose() {},
            register: () => true,
            unregister: () => true,
          };
        },
        createLifecycle: () => ({
          dispose() {},
          handleRequest: () => false,
          start: () => true,
        }),
        installRenderer: () => ({
          dispose() {},
          ready,
        }),
      },
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(nativeCreated, 0);

    resolveRenderer(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(nativeCreated, 1);
    app.emit("will-quit");
  });

  test("renderer rejection leaves the native runtime inactive", async () => {
    const app = new EventEmitter();
    app.commandLine = {
      getSwitchValue(name) {
        return name === "disable-features"
          ? AUDIO_SERVICE_FEATURE
          : "";
      },
    };
    app.whenReady = () => Promise.resolve();
    const capture = {
      dispose() {},
      getCoordinator: () => null,
    };
    let nativeCreated = 0;

    attachToElectron(
      { app },
      capture,
      {
        createNative: async () => {
          nativeCreated += 1;
          return {};
        },
        installRenderer: () => ({
          dispose() {},
          ready: Promise.resolve(false),
        }),
      },
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(nativeCreated, 0);
    app.emit("will-quit");
  });

  test("renderer failure tears down an active native bridge", async () => {
    const app = new EventEmitter();
    app.commandLine = {
      getSwitchValue(name) {
        return name === "disable-features"
          ? AUDIO_SERVICE_FEATURE
          : "";
      },
    };
    app.whenReady = () => Promise.resolve();
    const capture = {
      dispose() {},
      getCoordinator: () => null,
    };
    let failRenderer;
    let lifecycleDisposed = 0;
    let nativeDisposed = 0;

    attachToElectron(
      { app },
      capture,
      {
        createNative: async () => ({
          dispose() {
            nativeDisposed += 1;
          },
          register: () => true,
          unregister: () => true,
        }),
        createLifecycle: () => ({
          dispose() {
            lifecycleDisposed += 1;
          },
          handleRequest: () => false,
          start: () => true,
        }),
        installRenderer: (_electron, { onFailure }) => {
          failRenderer = onFailure;
          return {
            dispose() {},
            ready: Promise.resolve(true),
          };
        },
      },
    );
    await new Promise((resolve) => setImmediate(resolve));

    failRenderer("source-mismatch");
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
    let attached;
    assert.doesNotThrow(() => {
      attached = attachToElectron(
        { app },
        {
          dispose() {
            captureDisposed += 1;
            throw new Error("capture teardown");
          },
        },
      );
    });
    assert.equal(attached, false);
    assert.equal(captureDisposed, 1);
  });
});

describe("coordinator capture", () => {
  test("compile hook patches once, restores stock hook, and captures coordinator", () => {
    const globalObject = {};
    const compiled = [];
    const coordinator = {
      getSnapshot() {},
      control() {},
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
    assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
    assert.deepEqual(
      Object.keys(capture).sort(),
      ["dispose", "getCoordinator"],
    );
  });

  test("patch rejection or exception compiles byte-identical stock source", () => {
    for (const patchSource of [
      (source) => ({
        ok: false,
        reason: "test-drift",
        source,
      }),
      () => {
        throw new Error("test patch failure");
      },
    ]) {
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
        patchSource,
        setTimeoutFn: () => ({ unref() {} }),
        clearTimeoutFn: () => {},
      });

      assert.equal(
        new FakeModule()._compile("stock bytes", targetFilename()),
        "stock bytes",
      );
      assert.deepEqual(compiled, ["stock bytes"]);
      assert.equal(capture.getCoordinator(), null);
      assert.equal(FakeModule.prototype._compile, original);
      assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
    }
  });

  test("incomplete coordinator fails closed without controlActive coupling", () => {
    const globalObject = {};
    let receiver;
    function FakeModule() {}
    const original = function () {};
    FakeModule.prototype._compile = original;
    const capture = installCoordinatorCapture({
      moduleApi: FakeModule,
      globalObject,
      setTimeoutFn: () => ({ unref() {} }),
      clearTimeoutFn: () => {},
    });
    receiver = globalObject[CAPTURE_SYMBOL];

    receiver({ getSnapshot() {} });
    assert.equal(capture.getCoordinator(), null);
    assert.equal(FakeModule.prototype._compile, original);
    assert.equal(globalObject[CAPTURE_SYMBOL], undefined);

    receiver({
      getSnapshot() {},
      control() {},
    });
    assert.equal(
      capture.getCoordinator(),
      null,
      "a stale callback cannot revive a failed capture",
    );
  });

  test("capture timeout restores the stock compile path", () => {
    const globalObject = {};
    let timeout;
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
      setTimeoutFn: (callback) => {
        timeout = callback;
        return { unref() {} };
      },
      clearTimeoutFn: () => {},
    });

    timeout();
    assert.equal(capture.getCoordinator(), null);
    assert.equal(FakeModule.prototype._compile, original);
    assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
    assert.equal(
      new FakeModule()._compile("after timeout", targetFilename()),
      "after timeout",
    );
    assert.deepEqual(compiled, ["after timeout"]);
  });

  test("dispose clears a captured coordinator and remains idempotent", () => {
    const globalObject = {};
    let cleared = 0;
    function FakeModule() {}
    const original = function () {};
    FakeModule.prototype._compile = original;
    const capture = installCoordinatorCapture({
      moduleApi: FakeModule,
      globalObject,
      setTimeoutFn: () => ({ unref() {} }),
      clearTimeoutFn: () => {
        cleared += 1;
      },
    });
    const coordinator = {
      getSnapshot() {},
      control() {},
    };

    globalObject[CAPTURE_SYMBOL](coordinator);
    assert.equal(capture.getCoordinator(), coordinator);
    assert.equal(cleared, 1);

    capture.dispose();
    capture.dispose();
    assert.equal(capture.getCoordinator(), null);
    assert.equal(cleared, 1);
    assert.equal(FakeModule.prototype._compile, original);
    assert.equal(globalObject[CAPTURE_SYMBOL], undefined);
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
});

describe("launcher and preload contract", () => {
  test("launcher protocol is accepted by the preload", () => {
    const { appArguments } = parseArguments([]);
    assert.deepEqual(appArguments, [
      "--disable-features=AudioServiceOutOfProcess",
    ]);

    const environment = createEnvironment(
      {},
      {
        preloadPath: "/safe/preload.cjs",
      },
    );
    assert.equal(
      environment.NODE_OPTIONS,
      '--require="/safe/preload.cjs"',
    );
    const app = new EventEmitter();
    app.commandLine = { getSwitchValue: () => "" };
    app.whenReady = () => new Promise(() => {});
    const capture = {
      dispose() {},
      getCoordinator: () => null,
    };
    assert.equal(
      attachToElectron(
        { app },
        capture,
        {
          argumentsList: appArguments,
          installRenderer: () => ({
            dispose() {},
            ready: new Promise(() => {}),
          }),
        },
      ),
      true,
    );
    app.emit("will-quit");
  });
});
