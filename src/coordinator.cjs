"use strict";

const Module = require("node:module");
const {
  CAPTURE_SYMBOL_KEY,
  isMainBundle,
  patchMainSource,
} = require("./build-profile.cjs");

const CAPTURE_SYMBOL = Symbol.for(CAPTURE_SYMBOL_KEY);
const HOOK_MARKER = Symbol.for(
  "airpods-codex-mute.compile-hook.v1",
);
const DEFAULT_TIMEOUT_MS = 30_000;

function isVoiceCoordinator(value) {
  return Boolean(
    value &&
      typeof value.getSnapshot === "function" &&
      typeof value.control === "function" &&
      typeof value.controlActive === "function",
  );
}

function installCoordinatorCapture({
  moduleApi = Module,
  globalObject = globalThis,
  patchSource = patchMainSource,
  timeoutMs = DEFAULT_TIMEOUT_MS,
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
  let coordinator = null;
  let status = "waiting";
  let timer = null;
  let disposed = false;
  let failureListener = null;

  function restoreHook() {
    if (prototype._compile === compileWithCapture) {
      prototype._compile = originalCompile;
    }
    try {
      delete prototype[HOOK_MARKER];
    } catch {
      // The restored stock hook remains authoritative.
    }
  }

  function removeCaptureSlot() {
    if (globalObject[CAPTURE_SYMBOL] === receiveCoordinator) {
      try {
        delete globalObject[CAPTURE_SYMBOL];
      } catch {
        // An inert capture callback is safe if deletion is rejected.
      }
    }
  }

  function clearTimer() {
    if (timer === null) return;
    clearTimeoutFn(timer);
    timer = null;
  }

  function fail(reason) {
    if (disposed || status === "captured" || status === "failed") {
      return;
    }
    status = "failed";
    restoreHook();
    removeCaptureSlot();
    clearTimer();
    if (failureListener) {
      try {
        failureListener(reason);
      } catch {
        // Cleanup cannot affect the stock app.
      }
      failureListener = null;
    }
  }

  function receiveCoordinator(candidate) {
    if (disposed || status === "failed" || status === "captured") {
      return;
    }
    if (!isVoiceCoordinator(candidate)) {
      fail("invalid-coordinator");
      return;
    }
    coordinator = candidate;
    status = "captured";
    removeCaptureSlot();
    clearTimer();
    failureListener = null;
  }

  function compileWithCapture(source, filename) {
    if (!isMainBundle(filename)) {
      return Reflect.apply(originalCompile, this, arguments);
    }

    restoreHook();
    const patch = patchSource(source, filename);
    if (!patch.ok) {
      fail(patch.reason);
      return Reflect.apply(originalCompile, this, arguments);
    }

    status = "patched";
    return Reflect.apply(originalCompile, this, [
      patch.source,
      filename,
    ]);
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
      fail("capture-timeout");
    }, timeoutMs);
    timer?.unref?.();
  } catch (error) {
    restoreHook();
    removeCaptureSlot();
    clearTimer();
    throw error;
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      restoreHook();
      removeCaptureSlot();
      clearTimer();
      failureListener = null;
      coordinator = null;
      status = "disposed";
    },
    getCoordinator() {
      return coordinator;
    },
    getStatus() {
      return status;
    },
    onFailure(listener) {
      if (typeof listener !== "function") return () => {};
      if (status === "failed") {
        listener("already-failed");
        return () => {};
      }
      failureListener = listener;
      return () => {
        if (failureListener === listener) failureListener = null;
      };
    },
  };
}

module.exports = {
  installCoordinatorCapture,
};
