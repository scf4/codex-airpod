"use strict";

const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  CONTROL_COMMIT_SYMBOL_KEY,
} = require("./transforms.cjs");

const CONTROL_COMMIT_SYMBOL = Symbol.for(CONTROL_COMMIT_SYMBOL_KEY);
const AVFAUDIO =
  "/System/Library/Frameworks/AVFAudio.framework/AVFAudio";
const FOUNDATION =
  "/System/Library/Frameworks/Foundation.framework/Foundation";
const HANDLER_METHOD = "setInputMuteStateChangeHandler$error$";
const INPUT_MUTED = "isInputMuted";
const SET_INPUT_MUTED = "setInputMuted$error$";
const ADD_OBSERVER =
  "addObserverForName$object$queue$usingBlock$";
const REMOVE_OBSERVER = "removeObserver$";
const MUTE_NOTIFICATION =
  "AVAudioApplicationInputMuteStateChangeNotification";

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

async function loadBundledObjcJs(resourcesPath) {
  const requireFromApp = Module.createRequire(
    path.join(resourcesPath, "app.asar", "package.json"),
  );
  return import(
    pathToFileURL(requireFromApp.resolve("objc-js")).href
  );
}

async function createNativeGestureAdapter({
  onRequest,
  resourcesPath = process.resourcesPath,
  bridgeLoader = loadBundledObjcJs,
} = {}) {
  if (typeof onRequest !== "function") {
    throw new TypeError("onRequest must be a function");
  }

  const bridge = await bridgeLoader(resourcesPath);
  const { NobjcLibrary, typedBlock } = bridge ?? {};
  if (
    typeof NobjcLibrary !== "function" ||
    typeof typedBlock !== "function"
  ) {
    throw new Error("ChatGPT's bundled objc-js API is unavailable");
  }

  const avfaudio = new NobjcLibrary(AVFAUDIO);
  const foundation = new NobjcLibrary(FOUNDATION);
  const audioApplication =
    avfaudio.AVAudioApplication?.sharedInstance();
  const notificationCenter =
    foundation.NSNotificationCenter?.defaultCenter();
  const notificationName =
    foundation.NSString?.stringWithUTF8String$(MUTE_NOTIFICATION);

  if (
    !audioApplication ||
    !(HANDLER_METHOD in audioApplication) ||
    !(INPUT_MUTED in audioApplication) ||
    !(SET_INPUT_MUTED in audioApplication) ||
    !notificationCenter ||
    !(ADD_OBSERVER in notificationCenter) ||
    !(REMOVE_OBSERVER in notificationCenter) ||
    !notificationName
  ) {
    throw new Error("Required macOS mute-routing APIs are unavailable");
  }

  let disposed = false;
  let registered = false;
  let acceptingRequests = false;
  let observerToken = null;
  let synchronizingTarget = null;
  let retained;

  const notificationObserver = typedBlock(
    { returns: "v", args: ["@"] },
    () => {
      void retained;
    },
  );
  const handler = typedBlock(
    { returns: "B", args: ["B"] },
    (value) => {
      const requested = Boolean(value);
      if (!retained || !acceptingRequests) return false;
      if (synchronizingTarget !== null) {
        return requested === synchronizingTarget;
      }
      return returnsTrue(() => onRequest(requested));
    },
  );

  function addObserver() {
    if (!observerToken) {
      observerToken = safely(
        () =>
          notificationCenter[ADD_OBSERVER](
            notificationName,
            null,
            null,
            notificationObserver,
          ),
        null,
      );
    }
    return Boolean(observerToken);
  }

  function removeObserver() {
    if (!observerToken) return true;
    const removed = returnsTrue(() => {
      notificationCenter[REMOVE_OBSERVER](observerToken);
      return true;
    });
    if (removed) observerToken = null;
    return removed;
  }

  function register() {
    if (disposed) return false;
    if (registered) {
      acceptingRequests = true;
      return true;
    }
    if (!addObserver()) return false;

    acceptingRequests = false;
    registered = safely(
      () => Boolean(audioApplication[HANDLER_METHOD](handler, null)),
    );
    if (!registered) removeObserver();
    acceptingRequests = registered;
    return registered;
  }

  function unregister() {
    acceptingRequests = false;
    if (registered) {
      const removed = safely(
        () => Boolean(audioApplication[HANDLER_METHOD](null, null)),
      );
      if (!removed) return false;
      registered = false;
    }
    return removeObserver();
  }

  function synchronizeInputMuted(inputMuted) {
    if (disposed || !registered || !acceptingRequests) return false;

    const requested = Boolean(inputMuted);
    try {
      if (Boolean(audioApplication[INPUT_MUTED]()) === requested) {
        return true;
      }
      synchronizingTarget = requested;
      try {
        return Boolean(
          audioApplication[SET_INPUT_MUTED](requested, null),
        );
      } finally {
        synchronizingTarget = null;
      }
    } catch {
      return false;
    }
  }

  // objc-js proxies and blocks must outlive every native callback.
  retained = [
    audioApplication,
    avfaudio,
    bridge,
    foundation,
    handler,
    notificationCenter,
    notificationName,
    notificationObserver,
  ];

  return {
    dispose() {
      if (disposed) return;
      unregister();
      removeObserver();
      acceptingRequests = false;
      synchronizingTarget = null;
      disposed = true;
      if (!registered && !observerToken) retained = null;
    },
    register,
    synchronizeInputMuted,
    unregister,
  };
}

function isVoiceSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      ["starting", "active"].includes(snapshot.phase) &&
      typeof snapshot.locator?.hostId === "string" &&
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
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  pollMs = 100,
  retryMs = 250,
  deadlineMs = 1_000,
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

  let disposed = false;
  let timer = null;
  let pending = null;

  const callNative = (method, ...args) =>
    returnsTrue(() => nativeGesture[method](...args));

  function readVoice() {
    const coordinator = safely(getCoordinator, null);
    const controlWithCommit = safely(
      () => coordinator?.[CONTROL_COMMIT_SYMBOL],
      null,
    );
    if (
      typeof coordinator?.getSnapshot !== "function" ||
      typeof controlWithCommit !== "function"
    ) {
      return null;
    }

    const snapshot = safely(
      () => coordinator.getSnapshot(),
      null,
    );
    return isVoiceSnapshot(snapshot)
      ? { controlWithCommit, coordinator, snapshot }
      : null;
  }

  function synchronizeLatest() {
    if (disposed) return;
    const voice = readVoice();
    if (!voice) {
      pending = null;
      callNative("unregister");
      return;
    }
    if (!callNative("register")) return;
    callNative(
      "synchronizeInputMuted",
      voice.snapshot.microphoneMuted,
    );
  }

  function finish(request) {
    if (pending !== request) return;
    pending = null;
    synchronizeLatest();
  }

  function settleAttempt(request, committed) {
    request.awaiting -= 1;
    if (pending !== request) return;
    if (now() >= request.deadline) {
      finish(request);
      return;
    }
    if (committed === true) {
      finish(request);
      return;
    }
    if (request.attempts < 2) {
      sendAttempt(request);
      return;
    }
    if (request.awaiting === 0) finish(request);
  }

  function sendAttempt(request) {
    if (
      disposed ||
      pending !== request ||
      request.attempts >= 2
    ) {
      return false;
    }

    const voice = readVoice();
    if (!voice || !sameLocator(voice.snapshot.locator, request.locator)) {
      finish(request);
      return false;
    }

    request.attempts += 1;
    const outcome = safely(
      () =>
        Reflect.apply(
          voice.controlWithCommit,
          voice.coordinator,
          [
            request.locator,
            {
              type: "set-microphone-muted",
              muted: request.requested,
            },
          ],
        ),
      null,
    );
    const accepted =
      outcome?.accepted === true &&
      typeof outcome.committed?.then === "function";

    if (!accepted) {
      if (request.attempts < 2) return sendAttempt(request);
      if (request.awaiting === 0) finish(request);
      return false;
    }

    request.awaiting += 1;
    Promise.resolve(outcome.committed).then(
      (committed) => settleAttempt(request, committed),
      () => settleAttempt(request, false),
    );
    return true;
  }

  function tick() {
    if (disposed) return;

    const voice = readVoice();
    if (!voice) {
      pending = null;
      callNative("unregister");
      return;
    }
    if (
      pending &&
      !sameLocator(pending.locator, voice.snapshot.locator)
    ) {
      pending = null;
    }

    const currentTime = now();
    if (pending && currentTime >= pending.deadline) {
      pending = null;
    }

    if (!callNative("register")) return;
    if (pending) {
      if (
        pending.attempts < 2 &&
        currentTime >= pending.retryAt
      ) {
        sendAttempt(pending);
      }
      if (pending) return;
    }
    callNative(
      "synchronizeInputMuted",
      voice.snapshot.microphoneMuted,
    );
  }

  function handleRequest(value) {
    if (disposed) return false;
    const requested = Boolean(value);
    const voice = readVoice();
    if (!voice) {
      pending = null;
      callNative("unregister");
      return false;
    }
    if (
      pending &&
      !sameLocator(pending.locator, voice.snapshot.locator)
    ) {
      pending = null;
    }
    const currentTime = now();
    if (pending && currentTime >= pending.deadline) {
      pending = null;
    }
    if (!callNative("register")) return false;
    if (pending) return pending.requested === requested;

    const request = {
      attempts: 0,
      awaiting: 0,
      deadline: currentTime + deadlineMs,
      locator: {
        hostId: voice.snapshot.locator.hostId,
        conversationId: voice.snapshot.locator.conversationId,
      },
      requested,
      retryAt: currentTime + retryMs,
    };
    pending = request;
    return sendAttempt(request);
  }

  function nextPollDelay() {
    let delay = pollMs;
    if (!pending) return delay;

    const currentTime = now();
    if (pending.attempts < 2) {
      const untilRetry = pending.retryAt - currentTime;
      if (untilRetry > 0) delay = Math.min(delay, untilRetry);
    }
    return Math.min(
      delay,
      Math.max(0, pending.deadline - currentTime),
    );
  }

  function schedulePoll() {
    if (disposed || timer !== null) return;
    timer = setTimeoutFn(() => {
      timer = null;
      tick();
      schedulePoll();
    }, nextPollDelay());
    timer?.unref?.();
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      callNative("unregister");
    },
    handleRequest,
    start() {
      if (disposed || timer !== null) return false;
      tick();
      try {
        schedulePoll();
      } catch {
        timer = null;
        return false;
      }
      return true;
    },
    tick,
  };
}

module.exports = {
  CONTROL_COMMIT_SYMBOL_KEY,
  createNativeGestureAdapter,
  createVoiceMuteLifecycle,
  loadBundledObjcJs,
};
