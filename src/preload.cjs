"use strict";

const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const {
  createNativeGestureAdapter,
  createVoiceMuteLifecycle,
} = require("./airpods.cjs");
const {
  CAPTURE_SYMBOL_KEY,
  isMainBundle,
  isRendererBundle,
  patchMainSource,
  patchRendererSource,
} = require("./transforms.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const CAPTURE_SYMBOL = Symbol.for(CAPTURE_SYMBOL_KEY);
const HOOK_MARKER = Symbol.for("airpods-codex-mute.compile-hook.v1");

function safely(action, fallback = false) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

function returnsTrue(action) {
  return safely(action) === true;
}

function disposeSafely(value) {
  safely(() => value?.dispose?.());
}

function isVoiceCoordinator(value) {
  return Boolean(
    value &&
      typeof value.getSnapshot === "function" &&
      typeof value.control === "function",
  );
}

function isTargetRequest(request) {
  return (
    typeof request?.url === "string" &&
    request.url.startsWith("app://-/assets/") &&
    isRendererBundle(request.url)
  );
}

function installCoordinatorCapture({
  moduleApi = Module,
  globalObject = globalThis,
  patchSource = patchMainSource,
  timeoutMs = 30_000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const prototype = moduleApi?.prototype;
  if (
    !prototype ||
    typeof prototype._compile !== "function" ||
    prototype[HOOK_MARKER]
  ) {
    throw new Error("Coordinator compile hook is unavailable");
  }
  if (Object.hasOwn(globalObject, CAPTURE_SYMBOL)) {
    throw new Error("Coordinator capture slot is already occupied");
  }

  const originalCompile = prototype._compile;
  let accepting = true;
  let coordinator = null;
  let timer = null;

  function restoreHook() {
    if (prototype._compile === compileWithCapture) {
      prototype._compile = originalCompile;
    }
    safely(() => delete prototype[HOOK_MARKER]);
  }

  function removeSlot() {
    if (globalObject[CAPTURE_SYMBOL] === receiveCoordinator) {
      safely(() => delete globalObject[CAPTURE_SYMBOL]);
    }
  }

  function finish() {
    if (!accepting) return;
    accepting = false;
    restoreHook();
    removeSlot();
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  }

  function receiveCoordinator(candidate) {
    if (!accepting) return;
    if (isVoiceCoordinator(candidate)) coordinator = candidate;
    finish();
  }

  function compileWithCapture(source, filename) {
    if (!isMainBundle(filename)) {
      return Reflect.apply(originalCompile, this, arguments);
    }

    restoreHook();
    const patch = safely(() => patchSource(source, filename), null);
    if (!patch?.ok) finish();
    return Reflect.apply(
      originalCompile,
      this,
      patch?.ok ? [patch.source, filename] : arguments,
    );
  }

  try {
    Object.defineProperty(globalObject, CAPTURE_SYMBOL, {
      value: receiveCoordinator,
      configurable: true,
    });
    prototype._compile = compileWithCapture;
    Object.defineProperty(prototype, HOOK_MARKER, {
      value: true,
      configurable: true,
    });
    timer = setTimeoutFn(() => {
      timer = null;
      finish();
    }, timeoutMs);
    timer?.unref?.();
  } catch (error) {
    finish();
    throw error;
  }

  return {
    dispose() {
      finish();
      coordinator = null;
    },
    getCoordinator: () => coordinator,
  };
}

function installRendererAssetTransform(electron, { onFailure } = {}) {
  const protocol = electron?.protocol;
  if (typeof protocol?.handle !== "function") {
    throw new TypeError("Electron protocol.handle is unavailable");
  }

  const originalHandle = protocol.handle;
  let disposed = false;
  let failed = false;
  let failureReported = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function reportFailure(reason) {
    failed = true;
    resolveReady(false);
    if (failureReported) return;
    failureReported = true;
    safely(() => onFailure?.(reason));
  }

  function restoreHandle() {
    if (protocol.handle === handleWithTransform) {
      protocol.handle = originalHandle;
    }
  }

  function handleWithTransform(scheme, stockHandler) {
    if (scheme !== "app" || typeof stockHandler !== "function") {
      return Reflect.apply(originalHandle, this, arguments);
    }
    restoreHandle();
    const transformedHandler = async (request) => {
      let stockResponse;
      try {
        stockResponse = await stockHandler(request);
      } catch (error) {
        if (!disposed && isTargetRequest(request)) {
          reportFailure("stock-handler-failed");
        }
        throw error;
      }

      if (disposed || !isTargetRequest(request) || failed) return stockResponse;

      try {
        if (
          typeof stockResponse?.clone !== "function" ||
          typeof stockResponse?.text !== "function"
        ) {
          reportFailure("invalid-stock-response");
          return stockResponse;
        }

        const source = await stockResponse.clone().text();
        if (disposed || failed) return stockResponse;
        const result = patchRendererSource(source, request.url);
        if (!result.ok) {
          reportFailure(result.reason);
          return stockResponse;
        }
        const headers = new Headers(stockResponse.headers);
        headers.delete("content-length");
        const replacement = new Response(Buffer.from(result.source, "utf8"), {
          headers,
          status: stockResponse.status,
          statusText: stockResponse.statusText,
        });
        resolveReady(true);
        return replacement;
      } catch {
        reportFailure("renderer-transform-failed");
        return stockResponse;
      }
    };
    const delegated = [...arguments];
    delegated[1] = transformedHandler;

    try {
      return Reflect.apply(originalHandle, this, delegated);
    } catch (error) {
      reportFailure("app-protocol-registration-failed");
      throw error;
    }
  }

  try {
    protocol.handle = handleWithTransform;
  } catch (error) {
    reportFailure("protocol-hook-failed");
    throw error;
  }

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      restoreHandle();
      resolveReady(false);
    },
  };
}

function chromiumFeatures(app, switchName, argumentsList = process.argv) {
  const prefix = `--${switchName}=`;
  const argumentValues = argumentsList
    .filter(
      (value) =>
        typeof value === "string" && value.startsWith(prefix),
    )
    .map((value) => value.slice(prefix.length));
  const values = [
    app?.commandLine?.getSwitchValue?.(switchName),
    ...argumentValues,
  ];

  return new Set(
    values
      .filter((value) => typeof value === "string")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
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

function observeElectron(onElectron, { moduleApi = Module } = {}) {
  if (
    typeof onElectron !== "function" ||
    typeof moduleApi?._load !== "function"
  ) {
    return false;
  }

  const originalLoad = moduleApi._load;
  let delivered = false;

  function loadWithObserver(request) {
    const loaded = Reflect.apply(originalLoad, this, arguments);
    if (
      !delivered &&
      (request === "electron" || request === "electron/main") &&
      isElectronApi(loaded)
    ) {
      delivered = true;
      if (moduleApi._load === loadWithObserver) {
        safely(() => {
          moduleApi._load = originalLoad;
        });
      }
      safely(() => onElectron(loaded));
    }
    return loaded;
  }

  const installed = returnsTrue(() => {
    moduleApi._load = loadWithObserver;
    return true;
  });
  if (!installed) {
    safely(() => {
      moduleApi._load = originalLoad;
    });
  }
  return installed;
}

function attachToElectron(electron, capture, {
  createNative = createNativeGestureAdapter,
  createLifecycle = createVoiceMuteLifecycle,
  installRenderer = installRendererAssetTransform,
  argumentsList = process.argv,
} = {}) {
  if (!isElectronApi(electron)) return false;
  const { app } = electron;
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
    disposeSafely(capture);
    return false;
  }

  let lifecycle = null;
  let nativeGesture = null;
  let quitting = false;
  let rendererFailed = false;
  let rendererTransform = null;

  function disposeRuntime() {
    const retiring = [lifecycle, nativeGesture];
    lifecycle = null;
    nativeGesture = null;
    retiring.forEach(disposeSafely);
  }

  function cleanup() {
    if (quitting) return;
    quitting = true;
    disposeRuntime();
    const oldRendererTransform = rendererTransform;
    rendererTransform = null;
    disposeSafely(oldRendererTransform);
    disposeSafely(capture);
  }

  async function startRuntime() {
    const rendererReady = await rendererTransform?.ready;
    if (!rendererReady || quitting || rendererFailed) return;

    const createdNative = await createNative({
      onRequest: (requested) =>
        lifecycle?.handleRequest(requested) === true,
    });
    if (quitting || rendererFailed) {
      disposeSafely(createdNative);
      return;
    }
    nativeGesture = createdNative;
    lifecycle = createLifecycle(
      {
        getCoordinator: () => capture.getCoordinator(),
        nativeGesture,
      },
    );
    if (lifecycle.start() !== true) cleanup();
  }

  try {
    rendererTransform = installRenderer(electron, {
      onFailure() {
        rendererFailed = true;
        disposeRuntime();
      },
    });
    if (
      typeof rendererTransform?.ready?.then !== "function" ||
      typeof rendererTransform.dispose !== "function"
    ) {
      cleanup();
      return false;
    }

    app.on("will-quit", cleanup);
    void Promise.resolve(app.whenReady()).then(startRuntime).catch(cleanup);
    return true;
  } catch {
    cleanup();
    return false;
  }
}

function runPreload({ moduleApi = Module, globalObject = globalThis } = {}) {
  delete process.env.NODE_OPTIONS;
  try {
    const capture = installCoordinatorCapture({ globalObject, moduleApi });
    const observed = observeElectron(
      (electron) => attachToElectron(electron, capture),
      { moduleApi },
    );
    if (!observed) {
      disposeSafely(capture);
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
  installCoordinatorCapture,
  installRendererAssetTransform,
  observeElectron,
  runPreload,
};
