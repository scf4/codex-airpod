"use strict";

const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const {
  installCoordinatorCapture,
} = require("./coordinator.cjs");
const {
  createNativeGestureAdapter,
} = require("./native-gesture.cjs");
const {
  createVoiceMuteLifecycle,
} = require("./lifecycle.cjs");
const {
  installRendererAssetTransform,
} = require("./renderer.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const ELECTRON_HOOK = Symbol.for(
  "airpods-codex-mute.electron-hook.v1",
);
const APP_STATE = Symbol.for(
  "airpods-codex-mute.app-state.v1",
);

function stripManagedRequire(options, filename = __filename) {
  if (typeof options !== "string" || options.length === 0) {
    return options;
  }
  for (const managed of [
    `--require=${JSON.stringify(filename)}`,
    `--require=${filename}`,
  ]) {
    const index = options.indexOf(managed);
    if (index < 0) continue;
    const before = options.slice(0, index);
    const after = options.slice(index + managed.length);
    if ((before && !/\s$/.test(before)) || (after && !/^\s/.test(after))) {
      continue;
    }
    return `${before}${after}`.trim().replace(/\s{2,}/g, " ") || undefined;
  }
  return options;
}

function chromiumFeatures(
  app,
  switchName,
  argumentsList = process.argv,
) {
  const values = [];
  const value = app?.commandLine?.getSwitchValue?.(switchName);
  if (typeof value === "string" && value) values.push(value);
  const prefix = `--${switchName}=`;
  for (const argument of argumentsList) {
    if (typeof argument === "string" && argument.startsWith(prefix)) {
      values.push(argument.slice(prefix.length));
    }
  }
  return new Set(
    values
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function isElectronApi(value) {
  return Boolean(
    value?.app &&
      typeof value.app.on === "function" &&
      typeof value.app.whenReady === "function",
  );
}

function observeElectron(
  onElectron,
  { moduleApi = Module } = {},
) {
  if (
    typeof onElectron !== "function" ||
    typeof moduleApi?._load !== "function" ||
    moduleApi[ELECTRON_HOOK]
  ) {
    return false;
  }

  const originalLoad = moduleApi._load;
  function loadWithObserver(request, parent, isMain) {
    const loaded = Reflect.apply(originalLoad, this, arguments);
    if (
      (request === "electron" || request === "electron/main") &&
      isElectronApi(loaded)
    ) {
      if (moduleApi._load === loadWithObserver) {
        moduleApi._load = originalLoad;
      }
      try {
        onElectron(loaded);
      } catch {
        // A rejected attachment cannot affect stock Electron startup.
      }
    }
    return loaded;
  }

  try {
    moduleApi._load = loadWithObserver;
    Object.defineProperty(moduleApi, ELECTRON_HOOK, {
      value: true,
      configurable: false,
    });
    return true;
  } catch {
    moduleApi._load = originalLoad;
    return false;
  }
}

function attachToElectron(
  electron,
  capture,
  {
    createNative = createNativeGestureAdapter,
    createLifecycle = createVoiceMuteLifecycle,
    installRenderer = installRendererAssetTransform,
    argumentsList = process.argv,
  } = {},
) {
  if (!isElectronApi(electron)) return false;
  const { app } = electron;
  if (app[APP_STATE]) return true;

  const disabled = chromiumFeatures(
    app,
    "disable-features",
    argumentsList,
  );
  const enabled = chromiumFeatures(
    app,
    "enable-features",
    argumentsList,
  );
  if (
    !disabled.has(AUDIO_SERVICE_FEATURE) ||
    enabled.has(AUDIO_SERVICE_FEATURE)
  ) {
    capture.dispose();
    return false;
  }

  const state = {
    captureFailed: false,
    captureFailureUnsubscribe: null,
    lifecycle: null,
    nativeGesture: null,
    quitting: false,
    rendererFailed: false,
    rendererTransform: null,
  };
  function cleanup() {
    if (state.quitting) return;
    state.quitting = true;
    state.captureFailureUnsubscribe?.();
    state.captureFailureUnsubscribe = null;
    disposeRuntime();
    state.rendererTransform?.dispose?.();
    state.rendererTransform = null;
    capture.dispose();
  }

  function disposeRuntime() {
    state.lifecycle?.dispose();
    state.lifecycle = null;
    state.nativeGesture?.dispose();
    state.nativeGesture = null;
  }

  if (typeof capture.onFailure === "function") {
    state.captureFailureUnsubscribe = capture.onFailure(() => {
      state.captureFailed = true;
      disposeRuntime();
    });
  }

  let rendererTransform;
  try {
    rendererTransform = installRenderer(electron, {
      onFailure() {
        state.rendererFailed = true;
        disposeRuntime();
      },
    });
    state.rendererTransform = rendererTransform;
  } catch {
    cleanup();
    return false;
  }
  if (
    typeof rendererTransform?.ready?.then !== "function" ||
    typeof rendererTransform.dispose !== "function"
  ) {
    cleanup();
    return false;
  }

  Object.defineProperty(app, APP_STATE, {
    value: state,
    configurable: false,
  });
  app.on("will-quit", cleanup);

  void app
    .whenReady()
    .then(async () => {
      const rendererReady = await rendererTransform.ready;
      if (
        !rendererReady ||
        state.quitting ||
        state.captureFailed ||
        state.rendererFailed ||
        capture.getStatus() === "failed"
      ) {
        return;
      }

      let lifecycle = null;
      const nativeGesture = await createNative({
        onRequest: (requested) =>
          lifecycle?.handleRequest(requested) === true,
      });
      if (
        state.quitting ||
        state.captureFailed ||
        state.rendererFailed
      ) {
        nativeGesture.dispose();
        return;
      }

      state.nativeGesture = nativeGesture;
      lifecycle = createLifecycle({
        getCoordinator: () => capture.getCoordinator(),
        nativeGesture,
      });
      state.lifecycle = lifecycle;
      lifecycle.start();
    })
    .catch(() => {
      cleanup();
    });

  return true;
}

function runPreload({
  moduleApi = Module,
  globalObject = globalThis,
} = {}) {
  const remaining = stripManagedRequire(
    process.env.NODE_OPTIONS,
    __filename,
  );
  if (remaining === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = remaining;

  try {
    const capture = installCoordinatorCapture({
      globalObject,
      moduleApi,
    });
    if (
      !observeElectron(
        (electron) =>
          attachToElectron(electron, capture),
        { moduleApi },
      )
    ) {
      capture.dispose();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

if (
  isMainThread &&
  Boolean(process.versions.electron) &&
  process.type === "browser"
) {
  runPreload();
}

module.exports = {
  attachToElectron,
  chromiumFeatures,
  observeElectron,
  stripManagedRequire,
};
