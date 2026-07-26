"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  createNativeGestureAdapter,
} = require("../src/airpods.cjs");

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

function fakeBridge({ audioApplication, notificationCenter }) {
  return async () => ({
    NobjcLibrary: class FakeLibrary {
      constructor(framework) {
        if (framework === AVFAUDIO) {
          return {
            AVAudioApplication: {
              sharedInstance: () => audioApplication,
            },
          };
        }
        assert.equal(framework, FOUNDATION);
        return {
          NSNotificationCenter: {
            defaultCenter: () => notificationCenter,
          },
          NSString: {
            stringWithUTF8String$(value) {
              assert.equal(value, MUTE_NOTIFICATION);
              return { value };
            },
          },
        };
      }
    },
    typedBlock: (_signature, callback) => callback,
  });
}

describe("native AirPods mute adapter", () => {
  test("registration suppresses callbacks and accepted mute/unmute both return true", async () => {
    const calls = [];
    const requests = [];
    let nativeHandler;
    let registrationCallbackResult;
    const token = {};
    const audioApplication = {
      [HANDLER_METHOD](handler, error) {
        assert.equal(error, null);
        calls.push(["handler", handler]);
        if (handler) {
          nativeHandler = handler;
          registrationCallbackResult = handler(true);
        }
        return 1;
      },
      [INPUT_MUTED]: () => false,
      [SET_INPUT_MUTED]: () => true,
    };
    const center = {
      [ADD_OBSERVER](name, object, queue, observer) {
        assert.equal(object, null);
        assert.equal(queue, null);
        calls.push(["observer", name, observer]);
        return token;
      },
      [REMOVE_OBSERVER](value) {
        assert.equal(value, token);
        calls.push(["remove-observer"]);
      },
    };

    const adapter = await createNativeGestureAdapter({
      onRequest(requested) {
        requests.push(requested);
        return true;
      },
      bridgeLoader: fakeBridge({
        audioApplication,
        notificationCenter: center,
      }),
    });

    assert.equal(adapter.register(), true);
    assert.equal(calls[0][0], "observer");
    assert.equal(calls[1][0], "handler");
    assert.equal(registrationCallbackResult, false);
    assert.deepEqual(requests, []);

    assert.equal(nativeHandler(true), true);
    assert.equal(nativeHandler(false), true);
    assert.deepEqual(requests, [true, false]);

    assert.equal(adapter.unregister(), true);
    assert.equal(calls.at(-2)[0], "handler");
    assert.equal(calls.at(-2)[1], null);
    assert.equal(calls.at(-1)[0], "remove-observer");
    assert.equal(nativeHandler(true), false);
    assert.deepEqual(requests, [true, false]);
  });

  test("synchronization reads native truth and accepts setter reentry without redispatch", async () => {
    const calls = [];
    const requests = [];
    let nativeHandler;
    let nativeMuted = false;
    const center = {
      [ADD_OBSERVER]() {
        return {};
      },
      [REMOVE_OBSERVER]() {},
    };
    const audioApplication = {
      [HANDLER_METHOD](handler) {
        if (handler) nativeHandler = handler;
        return true;
      },
      [INPUT_MUTED]() {
        calls.push(["read", nativeMuted]);
        return nativeMuted;
      },
      [SET_INPUT_MUTED](requested, error) {
        assert.equal(error, null);
        calls.push(["write", requested]);
        const accepted = nativeHandler(requested);
        calls.push(["reentry", accepted]);
        if (accepted) nativeMuted = requested;
        return accepted ? 1 : 0;
      },
    };

    const adapter = await createNativeGestureAdapter({
      onRequest(requested) {
        requests.push(requested);
        return true;
      },
      bridgeLoader: fakeBridge({
        audioApplication,
        notificationCenter: center,
      }),
    });

    assert.equal(adapter.synchronizeInputMuted(false), false);
    assert.deepEqual(calls, []);
    assert.equal(adapter.register(), true);

    assert.equal(adapter.synchronizeInputMuted(false), true);
    assert.deepEqual(calls, [["read", false]]);

    assert.equal(adapter.synchronizeInputMuted(true), true);
    assert.deepEqual(calls.slice(-3), [
      ["read", false],
      ["write", true],
      ["reentry", true],
    ]);
    assert.deepEqual(requests, []);

    nativeMuted = false;
    assert.equal(adapter.synchronizeInputMuted(true), true);
    assert.deepEqual(calls.slice(-3), [
      ["read", false],
      ["write", true],
      ["reentry", true],
    ]);
    assert.deepEqual(requests, []);

    assert.equal(nativeHandler(false), true);
    assert.deepEqual(requests, [false]);
  });

  test("native callbacks fail closed when Codex rejects or throws", async () => {
    let nativeHandler;
    const outcomes = [
      () => false,
      () => {
        throw new Error("Codex request failed");
      },
    ];

    for (const onRequest of outcomes) {
      const adapter = await createNativeGestureAdapter({
        onRequest,
        bridgeLoader: fakeBridge({
          audioApplication: {
            [HANDLER_METHOD](handler) {
              if (handler) nativeHandler = handler;
              return true;
            },
            [INPUT_MUTED]: () => false,
            [SET_INPUT_MUTED]: () => true,
          },
          notificationCenter: {
            [ADD_OBSERVER]: () => ({}),
            [REMOVE_OBSERVER]() {},
          },
        }),
      });

      assert.equal(adapter.register(), true);
      assert.equal(nativeHandler(true), false);
      adapter.dispose();
    }
  });

  test("native synchronization failures return false without dispatching", async () => {
    for (const failure of ["read", "write-false", "write-throw"]) {
      const requests = [];
      let nativeHandler;
      const center = {
        [ADD_OBSERVER]: () => ({}),
        [REMOVE_OBSERVER]() {},
      };
      const audioApplication = {
        [HANDLER_METHOD](handler) {
          if (handler) nativeHandler = handler;
          return true;
        },
        [INPUT_MUTED]() {
          if (failure === "read") {
            throw new Error("native read failed");
          }
          return false;
        },
        [SET_INPUT_MUTED](requested) {
          if (failure === "write-throw") {
            throw new Error("native write failed");
          }
          assert.equal(nativeHandler(requested), true);
          return false;
        },
      };
      const adapter = await createNativeGestureAdapter({
        onRequest(requested) {
          requests.push(requested);
          return true;
        },
        bridgeLoader: fakeBridge({
          audioApplication,
          notificationCenter: center,
        }),
      });

      assert.equal(adapter.register(), true);
      assert.equal(adapter.synchronizeInputMuted(true), false);
      assert.deepEqual(requests, []);
    }
  });

  test("handler registration failure removes the opt-in observer", async () => {
    for (const handlerResult of [
      () => false,
      () => {
        throw new Error("native registration failed");
      },
    ]) {
      const calls = [];
      const center = {
        [ADD_OBSERVER]() {
          calls.push("add");
          return {};
        },
        [REMOVE_OBSERVER]() {
          calls.push("remove");
        },
      };
      const adapter = await createNativeGestureAdapter({
        onRequest: () => true,
        bridgeLoader: fakeBridge({
          audioApplication: {
            [HANDLER_METHOD]: handlerResult,
            [INPUT_MUTED]: () => false,
            [SET_INPUT_MUTED]: () => true,
          },
          notificationCenter: center,
        }),
      });

      assert.equal(adapter.register(), false);
      assert.deepEqual(calls, ["add", "remove"]);
    }
  });

  test("unregister contains handler and observer teardown failures", async () => {
    for (const failure of ["handler", "observer"]) {
      let nativeHandler;
      let handlerRemovalCalls = 0;
      let observerRemovalCalls = 0;
      const adapter = await createNativeGestureAdapter({
        onRequest: () => true,
        bridgeLoader: fakeBridge({
          audioApplication: {
            [HANDLER_METHOD](handler) {
              if (handler) {
                nativeHandler = handler;
                return true;
              }
              handlerRemovalCalls += 1;
              if (failure === "handler") {
                throw new Error("handler teardown failed");
              }
              return true;
            },
            [INPUT_MUTED]: () => false,
            [SET_INPUT_MUTED]: () => true,
          },
          notificationCenter: {
            [ADD_OBSERVER]: () => ({}),
            [REMOVE_OBSERVER]() {
              observerRemovalCalls += 1;
              if (failure === "observer") {
                throw new Error("observer teardown failed");
              }
            },
          },
        }),
      });

      assert.equal(adapter.register(), true);
      assert.equal(adapter.unregister(), false);
      assert.equal(nativeHandler(true), false);
      assert.equal(handlerRemovalCalls, 1);
      assert.equal(
        observerRemovalCalls,
        failure === "handler" ? 0 : 1,
      );
    }
  });

  test("dispose contains native teardown failures during quit cleanup", async () => {
    let nativeHandler;
    let handlerRemovalCalls = 0;
    let observerRemovalCalls = 0;
    const adapter = await createNativeGestureAdapter({
      onRequest: () => true,
      bridgeLoader: fakeBridge({
        audioApplication: {
          [HANDLER_METHOD](handler) {
            if (handler) {
              nativeHandler = handler;
              return true;
            }
            handlerRemovalCalls += 1;
            throw new Error("handler teardown failed");
          },
          [INPUT_MUTED]: () => false,
          [SET_INPUT_MUTED]: () => true,
        },
        notificationCenter: {
          [ADD_OBSERVER]: () => ({}),
          [REMOVE_OBSERVER]() {
            observerRemovalCalls += 1;
            throw new Error("observer teardown failed");
          },
        },
      }),
    });

    assert.equal(adapter.register(), true);
    assert.doesNotThrow(() => adapter.dispose());
    assert.doesNotThrow(() => adapter.dispose());
    assert.equal(handlerRemovalCalls, 1);
    assert.equal(observerRemovalCalls, 1);
    assert.equal(nativeHandler(false), false);
    assert.equal(adapter.synchronizeInputMuted(false), false);
  });

  test("both app-level mute selectors are required", async () => {
    for (const missing of [INPUT_MUTED, SET_INPUT_MUTED]) {
      const audioApplication = {
        [HANDLER_METHOD]: () => true,
        [INPUT_MUTED]: () => false,
        [SET_INPUT_MUTED]: () => true,
      };
      delete audioApplication[missing];

      await assert.rejects(
        createNativeGestureAdapter({
          onRequest: () => true,
          bridgeLoader: fakeBridge({
            audioApplication,
            notificationCenter: {
              [ADD_OBSERVER]: () => ({}),
              [REMOVE_OBSERVER]() {},
            },
          }),
        }),
        /Required macOS mute-routing APIs are unavailable/,
      );
    }
  });
});
