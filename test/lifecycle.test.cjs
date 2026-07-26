"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createVoiceMuteLifecycle,
} = require("../src/lifecycle.cjs");

function voiceSnapshot({
  hostId = "local",
  conversationId = "conversation",
  microphoneMuted = false,
  phase = "active",
} = {}) {
  return {
    phase,
    locator:
      phase === "inactive"
        ? null
        : { hostId, conversationId },
    microphoneMuted,
  };
}

function harness({
  initialSnapshot = voiceSnapshot(),
  control = () => true,
  synchronize = () => true,
  now = () => 0,
  confirmMs = 2_500,
} = {}) {
  let snapshot = initialSnapshot;
  let lifecycle;
  const nativeCalls = [];
  const controls = [];
  const nativeGesture = {
    register() {
      nativeCalls.push(["register"]);
      return true;
    },
    unregister() {
      nativeCalls.push(["unregister"]);
      return true;
    },
    synchronizeInputMuted(muted) {
      nativeCalls.push(["synchronize", muted]);
      return synchronize(
        muted,
        (requested) => lifecycle.handleRequest(requested),
      );
    },
  };
  const coordinator = {
    getSnapshot: () => snapshot,
    control(locator, command) {
      controls.push({ locator, command });
      return control(locator, command);
    },
  };
  lifecycle = createVoiceMuteLifecycle({
    getCoordinator: () => coordinator,
    nativeGesture,
    now,
    confirmMs,
    defer: (callback) => callback(),
  });

  return {
    controls,
    lifecycle,
    nativeCalls,
    setSnapshot(value) {
      snapshot = value;
    },
  };
}

test("AirPods requests use only the exact canonical Codex command", () => {
  const app = harness();
  app.lifecycle.tick();

  assert.equal(app.lifecycle.handleRequest(true), true);
  assert.deepEqual(app.controls, [
    {
      locator: {
        hostId: "local",
        conversationId: "conversation",
      },
      command: {
        type: "set-microphone-muted",
        muted: true,
      },
    },
  ]);

  app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
  app.lifecycle.tick();
});

test("same pending request coalesces while the opposite is rejected", () => {
  const app = harness();
  app.lifecycle.tick();

  assert.equal(app.lifecycle.handleRequest(true), true);
  assert.equal(app.lifecycle.handleRequest(true), true);
  assert.equal(app.controls.length, 1);
  assert.equal(app.lifecycle.handleRequest(false), false);
  assert.equal(app.controls.length, 1);
});

test("same-state AirPods requests still traverse the Codex owner path", () => {
  const app = harness({
    initialSnapshot: voiceSnapshot({ microphoneMuted: true }),
  });
  app.lifecycle.tick();

  assert.equal(app.lifecycle.handleRequest(true), true);
  assert.deepEqual(app.controls, [
    {
      locator: {
        hostId: "local",
        conversationId: "conversation",
      },
      command: {
        type: "set-microphone-muted",
        muted: true,
      },
    },
  ]);
});

test("initial and UI-originated Codex state synchronize Apple without redispatch", () => {
  const app = harness();
  app.lifecycle.tick();
  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
  ]);

  app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
  app.lifecycle.tick();
  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
    ["synchronize", true],
  ]);
  assert.deepEqual(app.controls, []);
});

test("stale committed snapshots are not mirrored while a request is pending", () => {
  const app = harness();
  app.lifecycle.tick();
  assert.equal(app.lifecycle.handleRequest(true), true);

  app.lifecycle.tick();
  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
  ]);

  app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
  app.lifecycle.tick();
  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
    ["synchronize", true],
  ]);
});

test("a replacement Voice session drops pending state and synchronizes its snapshot", () => {
  const app = harness();
  app.lifecycle.tick();
  assert.equal(app.lifecycle.handleRequest(true), true);

  app.setSnapshot(
    voiceSnapshot({
      hostId: "replacement",
      conversationId: "other-conversation",
      microphoneMuted: false,
    }),
  );
  app.lifecycle.tick();

  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
    ["unregister"],
    ["register"],
    ["synchronize", false],
  ]);
  assert.equal(app.lifecycle.handleRequest(true), true);
  assert.equal(app.controls.length, 2);
  assert.deepEqual(app.controls[1].locator, {
    hostId: "replacement",
    conversationId: "other-conversation",
  });
});

test("inactive or stopping Voice unregisters and rejects gestures", () => {
  for (const phase of ["inactive", "stopping"]) {
    const app = harness();
    app.lifecycle.tick();
    app.setSnapshot(voiceSnapshot({ phase }));
    app.lifecycle.tick();

    assert.deepEqual(app.nativeCalls, [
      ["register"],
      ["synchronize", false],
      ["unregister"],
    ]);
    assert.equal(app.lifecycle.handleRequest(true), false);
  }
});

test("Codex rejection and exceptions fail closed for the session", () => {
  for (const control of [
    () => false,
    () => {
      throw new Error("renderer unavailable");
    },
  ]) {
    const app = harness({ control });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), false);
    assert.deepEqual(app.nativeCalls, [
      ["register"],
      ["synchronize", false],
      ["unregister"],
    ]);
    assert.equal(app.lifecycle.handleRequest(true), false);
  }
});

test("unconfirmed state restores committed Codex state before disabling", () => {
  let clock = 0;
  const app = harness({
    now: () => clock,
    confirmMs: 2_000,
  });
  app.lifecycle.tick();
  assert.equal(app.lifecycle.handleRequest(true), true);

  clock = 2_001;
  app.lifecycle.tick();
  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
    ["synchronize", false],
    ["unregister"],
  ]);
  assert.equal(app.lifecycle.handleRequest(true), false);
});

test("synchronization failure disables the current session", () => {
  const app = harness({
    synchronize: () => false,
  });
  app.lifecycle.tick();

  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", false],
    ["unregister"],
  ]);
  assert.equal(app.lifecycle.handleRequest(true), false);
});

test("teardown unregisters after the initial synchronization", () => {
  const app = harness({
    initialSnapshot: voiceSnapshot({ microphoneMuted: true }),
  });
  app.lifecycle.tick();
  app.lifecycle.dispose();
  app.lifecycle.dispose();
  assert.deepEqual(app.nativeCalls, [
    ["register"],
    ["synchronize", true],
    ["unregister"],
  ]);
});
