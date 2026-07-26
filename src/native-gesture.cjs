"use strict";

const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const AVFAUDIO =
  "/System/Library/Frameworks/AVFAudio.framework/AVFAudio";
const FOUNDATION =
  "/System/Library/Frameworks/Foundation.framework/Foundation";
const HANDLER_METHOD =
  "setInputMuteStateChangeHandler$error$";
const INPUT_MUTED = "isInputMuted";
const SET_INPUT_MUTED = "setInputMuted$error$";
const ADD_OBSERVER =
  "addObserverForName$object$queue$usingBlock$";
const REMOVE_OBSERVER = "removeObserver$";
const MUTE_NOTIFICATION =
  "AVAudioApplicationInputMuteStateChangeNotification";

async function loadBundledObjcJs(resourcesPath) {
  const requireFromApp = Module.createRequire(
    path.join(resourcesPath, "app.asar", "package.json"),
  );
  const entry = requireFromApp.resolve("objc-js");
  return import(pathToFileURL(entry).href);
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
    foundation.NSString?.stringWithUTF8String$(
      MUTE_NOTIFICATION,
    );

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
    () => {},
  );

  const handler = typedBlock(
    { returns: "B", args: ["B"] },
    (inputShouldBeMuted) => {
      const requested = Boolean(inputShouldBeMuted);
      if (!acceptingRequests) return false;
      if (synchronizingTarget !== null) {
        return requested === synchronizingTarget;
      }
      try {
        return onRequest(requested) === true;
      } catch {
        return false;
      }
    },
  );

  function addObserver() {
    if (observerToken) return true;
    observerToken = notificationCenter[ADD_OBSERVER](
      notificationName,
      null,
      null,
      notificationObserver,
    );
    return Boolean(observerToken);
  }

  function removeObserver() {
    if (!observerToken) return;
    const token = observerToken;
    observerToken = null;
    notificationCenter[REMOVE_OBSERVER](token);
  }

  function register() {
    if (disposed) return false;
    if (registered) {
      acceptingRequests = true;
      return true;
    }
    if (!addObserver()) return false;

    acceptingRequests = false;
    try {
      registered = Boolean(
        audioApplication[HANDLER_METHOD](handler, null),
      );
    } catch {
      registered = false;
    }
    if (!registered) {
      try {
        removeObserver();
      } catch {
        // Registration remains failed closed.
      }
    }
    acceptingRequests = registered;
    return registered;
  }

  function unregister() {
    if (!registered) {
      acceptingRequests = false;
      removeObserver();
      return true;
    }
    acceptingRequests = false;
    const removed = Boolean(
      audioApplication[HANDLER_METHOD](null, null),
    );
    if (removed) {
      registered = false;
      removeObserver();
    }
    return removed;
  }

  function synchronizeInputMuted(inputMuted) {
    if (disposed || !registered || !acceptingRequests) {
      return false;
    }

    const requested = Boolean(inputMuted);
    try {
      if (
        Boolean(audioApplication[INPUT_MUTED]()) === requested
      ) {
        return true;
      }

      synchronizingTarget = requested;
      try {
        return (
          audioApplication[SET_INPUT_MUTED](requested, null) ===
          true
        );
      } finally {
        synchronizingTarget = null;
      }
    } catch {
      return false;
    }
  }

  // objc-js proxies and blocks must remain live for native callbacks.
  retained = {
    audioApplication,
    avfaudio,
    bridge,
    foundation,
    handler,
    notificationCenter,
    notificationName,
    notificationObserver,
  };

  return {
    dispose() {
      if (disposed) return;
      try {
        unregister();
      } finally {
        try {
          removeObserver();
        } finally {
          registered = false;
          acceptingRequests = false;
          synchronizingTarget = null;
          disposed = true;
          retained = null;
        }
      }
    },
    register,
    synchronizeInputMuted,
    unregister,
  };
}

module.exports = {
  createNativeGestureAdapter,
};
