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
    !notificationCenter ||
    !(ADD_OBSERVER in notificationCenter) ||
    !(REMOVE_OBSERVER in notificationCenter) ||
    !notificationName
  ) {
    throw new Error("Required macOS mute-routing APIs are unavailable");
  }

  let disposed = false;
  let registered = false;
  let observerToken = null;
  let retained;

  const notificationObserver = typedBlock(
    { returns: "v", args: ["@"] },
    () => {},
  );

  const handler = typedBlock(
    { returns: "B", args: ["B"] },
    (inputShouldBeMuted) => {
      try {
        return onRequest(Boolean(inputShouldBeMuted)) === true;
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
    if (registered) return true;
    if (!addObserver()) return false;

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
    return registered;
  }

  function unregister() {
    if (!registered) {
      removeObserver();
      return true;
    }
    const removed = Boolean(
      audioApplication[HANDLER_METHOD](null, null),
    );
    if (removed) {
      registered = false;
      removeObserver();
    }
    return removed;
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
          disposed = true;
          retained = null;
        }
      }
    },
    register,
    unregister,
  };
}

module.exports = {
  createNativeGestureAdapter,
};
