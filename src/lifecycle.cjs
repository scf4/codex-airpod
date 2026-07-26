"use strict";

const POLL_MS = 100;
const CONFIRM_MS = 2_500;

function isVoiceSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      (snapshot.phase === "starting" || snapshot.phase === "active") &&
      snapshot.locator &&
      typeof snapshot.locator.hostId === "string" &&
      snapshot.locator.hostId.length > 0 &&
      typeof snapshot.locator.conversationId === "string" &&
      snapshot.locator.conversationId.length > 0 &&
      typeof snapshot.microphoneMuted === "boolean",
  );
}

function sameLocator(left, right) {
  return Boolean(
    left &&
      right &&
      left.hostId === right.hostId &&
      left.conversationId === right.conversationId,
  );
}

function createVoiceMuteLifecycle({
  getCoordinator,
  nativeGesture,
  now = Date.now,
  defer = setImmediate,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  pollMs = POLL_MS,
  confirmMs = CONFIRM_MS,
} = {}) {
  if (typeof getCoordinator !== "function") {
    throw new TypeError("getCoordinator must be a function");
  }
  if (
    !nativeGesture ||
    typeof nativeGesture.register !== "function" ||
    typeof nativeGesture.unregister !== "function" ||
    typeof nativeGesture.synchronizeInputMuted !== "function"
  ) {
    throw new TypeError("nativeGesture is incomplete");
  }

  const state = {
    activeLocator: null,
    disabled: false,
    disposed: false,
    pending: null,
    registered: false,
    timer: null,
    ticking: false,
  };

  function readVoice() {
    const coordinator = getCoordinator();
    if (
      !coordinator ||
      typeof coordinator.getSnapshot !== "function" ||
      typeof coordinator.control !== "function"
    ) {
      return null;
    }
    const snapshot = coordinator.getSnapshot();
    return isVoiceSnapshot(snapshot)
      ? { coordinator, snapshot }
      : null;
  }

  function unregister() {
    if (!state.registered) return true;
    let removed = false;
    try {
      removed = nativeGesture.unregister() === true;
    } catch {
      removed = false;
    }
    state.registered = !removed;
    return removed;
  }

  function deactivate() {
    state.pending = null;
    unregister();
    state.activeLocator = null;
  }

  function disable(snapshot) {
    if (!isVoiceSnapshot(snapshot)) {
      deactivate();
      return;
    }
    state.disabled = true;
    state.pending = null;
    unregister();
  }

  function synchronize(snapshot) {
    try {
      return (
        nativeGesture.synchronizeInputMuted(
          snapshot.microphoneMuted,
        ) === true
      );
    } catch {
      return false;
    }
  }

  function activate(snapshot) {
    state.activeLocator = { ...snapshot.locator };
    state.disabled = false;
    state.pending = null;

    // Registration can synchronously call the native handler.
    state.registered = true;
    let accepted = false;
    try {
      accepted = nativeGesture.register() === true;
    } catch {
      accepted = false;
    }
    if (!accepted) {
      state.registered = false;
      disable(snapshot);
      return false;
    }
    if (!state.pending && !synchronize(snapshot)) {
      disable(snapshot);
      return false;
    }
    return true;
  }

  function tick() {
    if (state.disposed || state.ticking) return;
    state.ticking = true;
    try {
      let voice;
      try {
        voice = readVoice();
      } catch {
        if (state.registered || state.activeLocator) {
          deactivate();
        }
        return;
      }

      if (!voice) {
        if (state.registered || state.activeLocator) {
          deactivate();
        }
        state.disabled = false;
        return;
      }

      const { snapshot } = voice;
      if (
        state.disabled &&
        sameLocator(state.activeLocator, snapshot.locator)
      ) {
        return;
      }
      if (
        state.disabled &&
        !sameLocator(state.activeLocator, snapshot.locator)
      ) {
        state.disabled = false;
      }

      if (
        !state.activeLocator ||
        !sameLocator(state.activeLocator, snapshot.locator)
      ) {
        if (state.registered || state.activeLocator) deactivate();
        activate(snapshot);
        return;
      }

      if (!state.pending) {
        if (!synchronize(snapshot)) disable(snapshot);
        return;
      }
      if (
        snapshot.microphoneMuted === state.pending.requested
      ) {
        state.pending = null;
        if (!synchronize(snapshot)) disable(snapshot);
        return;
      }
      if (now() >= state.pending.deadline) {
        state.pending = null;
        synchronize(snapshot);
        disable(snapshot);
      }
    } finally {
      state.ticking = false;
    }
  }

  function disableSoon(snapshot) {
    defer(() => {
      if (
        state.disposed ||
        !state.activeLocator ||
        !sameLocator(state.activeLocator, snapshot.locator)
      ) {
        return;
      }
      let latest = snapshot;
      try {
        const voice = readVoice();
        if (
          voice &&
          sameLocator(voice.snapshot.locator, snapshot.locator)
        ) {
          latest = voice.snapshot;
        }
      } catch {
        // The synchronous snapshot remains sufficient to disable.
      }
      disable(latest);
    });
  }

  function handleRequest(value) {
    const requested = Boolean(value);
    if (state.disposed || !state.registered) return false;

    let voice;
    try {
      voice = readVoice();
    } catch {
      return false;
    }
    if (
      !voice ||
      !state.activeLocator ||
      !sameLocator(state.activeLocator, voice.snapshot.locator) ||
      state.disabled
    ) {
      return false;
    }

    const { coordinator, snapshot } = voice;
    if (
      state.pending &&
      state.pending.requested === requested
    ) {
      return true;
    }
    if (state.pending) return false;

    let accepted = false;
    try {
      accepted =
        coordinator.control(snapshot.locator, {
          type: "set-microphone-muted",
          muted: requested,
        }) === true;
    } catch {
      accepted = false;
    }
    if (!accepted) {
      disableSoon(snapshot);
      return false;
    }

    state.pending = {
      deadline: now() + confirmMs,
      requested,
    };
    return true;
  }

  return {
    dispose() {
      if (state.disposed) return;
      if (state.timer !== null) {
        clearIntervalFn(state.timer);
        state.timer = null;
      }
      deactivate();
      state.disabled = false;
      state.disposed = true;
    },
    handleRequest,
    start() {
      if (state.disposed || state.timer !== null) return false;
      tick();
      state.timer = setIntervalFn(tick, pollMs);
      state.timer?.unref?.();
      return true;
    },
    tick,
  };
}

module.exports = {
  createVoiceMuteLifecycle,
};
