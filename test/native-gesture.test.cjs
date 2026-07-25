"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createNativeGestureAdapter,
} = require("../src/native-gesture.cjs");

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

test("notification opt-in precedes handler and exact booleans are returned", async () => {
  const calls = [];
  let nativeHandler;
  let notificationObserver;
  const token = {};
  const audioApplication = {
    [HANDLER_METHOD](handler, error) {
      assert.equal(error, null);
      nativeHandler = handler;
      calls.push(["handler", handler]);
      return true;
    },
  };
  const center = {
    [ADD_OBSERVER](name, object, queue, observer) {
      assert.equal(object, null);
      assert.equal(queue, null);
      notificationObserver = observer;
      calls.push(["observer", name]);
      return token;
    },
    [REMOVE_OBSERVER](value) {
      assert.equal(value, token);
      calls.push(["remove-observer"]);
    },
  };

  const adapter = await createNativeGestureAdapter({
    onRequest: (requested) => requested,
    bridgeLoader: async () => ({
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
              defaultCenter: () => center,
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
    }),
  });

  assert.equal(adapter.register(), true);
  assert.equal(calls[0][0], "observer");
  assert.equal(calls[1][0], "handler");
  assert.equal(nativeHandler(true), true);
  assert.equal(nativeHandler(false), false);
  notificationObserver({});

  assert.equal(adapter.unregister(), true);
  assert.equal(calls.at(-2)[0], "handler");
  assert.equal(calls.at(-2)[1], null);
  assert.equal(calls.at(-1)[0], "remove-observer");
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
      bridgeLoader: async () => ({
        NobjcLibrary: class FakeLibrary {
          constructor(framework) {
            return framework === AVFAUDIO
              ? {
                  AVAudioApplication: {
                    sharedInstance: () => ({
                      [HANDLER_METHOD]: handlerResult,
                    }),
                  },
                }
              : {
                  NSNotificationCenter: {
                    defaultCenter: () => center,
                  },
                  NSString: {
                    stringWithUTF8String$: () => ({}),
                  },
                };
          }
        },
        typedBlock: (_signature, callback) => callback,
      }),
    });

    assert.equal(adapter.register(), false);
    assert.deepEqual(calls, ["add", "remove"]);
  }
});
