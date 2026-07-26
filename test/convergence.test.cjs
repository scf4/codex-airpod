"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const vm = require("node:vm");
const {
  patchMainSource,
  patchRendererSource,
} = require("../src/transforms.cjs");
const {
  CONTROL_COMMIT_SYMBOL_KEY,
  createVoiceMuteLifecycle,
} = require("../src/airpods.cjs");

const CONTROL_COMMIT_SYMBOL = Symbol.for(
  CONTROL_COMMIT_SYMBOL_KEY,
);

const MAIN_FILENAME =
  "/Applications/ChatGPT.app/Contents/Resources/app.asar/" +
  ".vite/build/main-convergence.js";
const RENDERER_URL =
  "app://-/assets/app-initial-convergence.js";

function mainSource() {
  return (
    "function same(e,t){return e.hostId===t.hostId&&" +
    "e.conversationId===t.conversationId}" +
    "class Coordinator{" +
    "#session;history=[];" +
    "constructor(){this.#session={claimId:`claim`,cleanup:`none`," +
    "controller:null,published:!0," +
    "pendingMicrophoneMuteIntents:[],pendingOutputMuteIntents:[]," +
    "snapshot:{activity:`idle`,locator:{hostId:`local`," +
    "conversationId:`conversation`},microphoneMuted:!1," +
    "outputMuted:!1,phase:`active`,preferredPresentationSurface:null," +
    "sessionId:null}}}" +
    "setController(e){this.#session.controller=e}" +
    "getSnapshot(){return this.#session.snapshot}" +
    "publish(e,t){let n=this.#session;n?.claimId!==e||" +
    "n.cleanup!==`none`||(n.snapshot={...t,locator:n.snapshot.locator," +
    "preferredPresentationSurface:n.snapshot.preferredPresentationSurface," +
    "sessionId:n.snapshot.sessionId}," +
    "n.pendingMicrophoneMuteIntents[0]?.muted===" +
    "t.microphoneMuted&&n.pendingMicrophoneMuteIntents.shift()," +
    "n.pendingOutputMuteIntents[0]?.muted===" +
    "t.outputMuted&&n.pendingOutputMuteIntents.shift()," +
    "n.published=!0,this.history.push(t.microphoneMuted))}" +
    "breakOwner(){let e=this.#session;e.pendingMicrophoneMuteIntents=[]," +
    "e.pendingOutputMuteIntents=[],e.cleanup=`orphaned`," +
    "e.snapshot={activity:`idle`," +
    "locator:null,microphoneMuted:!1,outputMuted:!1,phase:`inactive`}}" +
    "control(e,t){let n=this.#session;if(n==null||n.cleanup!==`none`||" +
    "n.snapshot.phase===`stopping`||!same(n.snapshot.locator,e))return!1;" +
    "switch(t.type){case`set-microphone-muted`:case`set-output-muted`:" +
    "return this.#i(n,t),!0}}controlActive(){}" +
    "#i(e,t){let n=t.type===`set-microphone-muted`?" +
    "e.pendingMicrophoneMuteIntents:e.pendingOutputMuteIntents;" +
    "if((n.at(-1)?.muted??(t.type===`set-microphone-muted`?" +
    "e.snapshot.microphoneMuted:e.snapshot.outputMuted))===t.muted)" +
    "return;let r={...t};n.push(r),this.#a(e,n,r)}" +
    "async#a(e,t,n){try{await e.controller.control(n)}catch(r){" +
    "if(this.#session!==e||e.cleanup!==`none`)return;" +
    "let i=t.indexOf(n);i!==-1&&t.splice(i,1)}}" +
    "}" +
    "class App{constructor(a,b,c,d,e,f){this.disposables={add(){}},this." +
    "realtime={continuity:a,memory:b,presentation:c.rpc,voiceHistory:d," +
    "multiAgentActivity:e,voice:f.rpc},this.disposables.add(c.dispose)}}" +
    "const coordinator=new Coordinator,dependency={rpc:{},dispose(){}};" +
    "new App({},{},dependency,{}, {},{rpc:coordinator});" +
    "globalThis.fixture=coordinator;"
  );
}

function rendererSource() {
  return (
    "let gp=null;" +
    "function up(){return{u(){},e:null,d(){}}}" +
    "class Claim{#t=`claim`;#n=null;" +
    "publish(e){try{var t=up();if(this.#t==null)return;let n=this.#n;" +
    "if(n!=null&&n.activity===e.activity&&" +
    "n.microphoneMuted===e.microphoneMuted&&" +
    "n.outputMuted===e.outputMuted&&n.phase===e.phase)return;" +
    "this.#n=e,t.u(gp?.realtimeVoice?.publish(this.#t,e))}" +
    "catch(e){t.e=e}finally{t.d()}}}" +
    "const bX={},CX={},SX={},xX={};" +
    "const values=new Map([[bX,`active`],[CX,`listening`]," +
    "[SX,!1],[xX,!1]]);" +
    "const stateStore={get(e){return values.get(e)}," +
    "set(e,t){values.set(e,t)}};" +
    "const claimInstance=new Claim;" +
    "class Owner{constructor(){this.conversationId=`conversation`;" +
    "this.runtime={inputCalls:[],setInputMuted(e){" +
    "this.inputCalls.push(e)}};this.realtimeVoiceHostClaim=claimInstance;" +
    "this.orbUpdates=0}" +
    "toggleMicrophoneMute(e,t){if(this.conversationId!==t||" +
    "e.get(bX)!==`starting`&&e.get(bX)!==`active`||" +
    "this.runtime==null)return;let n=!e.get(SX);" +
    "this.applyRealtimeMicrophoneMuteState(e,n)}" +
    "applyRealtimeMicrophoneMuteState(e,t){" +
    "this.runtime?.setInputMuted(t),e.set(SX,t)," +
    "this.publishRealtimeVoiceHostState(e)}" +
    "handleRealtimeVoiceHostControl(e,t,n){" +
    "if(this.conversationId===t)switch(n.type){" +
    "case`set-microphone-muted`:e.get(SX)!==n.muted&&" +
    "this.applyRealtimeMicrophoneMuteState(e,n.muted);break;}}" +
    "publishRealtimeVoiceHostState(e){let t=e.get(bX);t!==`inactive`&&(" +
    "this.realtimeVoiceHostClaim.publish({activity:e.get(CX)," +
    "microphoneMuted:e.get(SX),outputMuted:e.get(xX),phase:t})," +
    "this.updateRealtimeVoiceOrbAudioStream())}" +
    "updateRealtimeVoiceOrbAudioStream(){this.orbUpdates+=1}}" +
    "const owner=new Owner;" +
    "const snapshot={microphoneMuted:!1,outputMuted:!1,phase:`active`," +
    "locator:{conversationId:`conversation`,hostId:`local`}}," +
    "conversationId=`conversation`,hostId=`local`,unavailable=!1," +
    "p={isMicrophoneMuted:!0,isMuted:!1,phase:`active`};" +
    "const _=snapshot.phase!==`inactive`&&conversationId!=null&&" +
    "snapshot.locator.conversationId===conversationId&&" +
    "snapshot.locator.hostId===hostId?snapshot:null," +
    "footerPhase=unavailable?`inactive`:_?.phase??p.phase," +
    "footerOutput=_?.outputMuted??p.isMuted," +
    "footer=_?.microphoneMuted??p.isMicrophoneMuted;" +
    "void footerPhase;void footerOutput;void footer;" +
    "globalThis.fixture={" +
    "control(e){owner.handleRealtimeVoiceHostControl(" +
    "stateStore,`conversation`,e)}," +
    "deactivate(){stateStore.set(bX,`inactive`)}," +
    "getMuted(){return stateStore.get(SX)}," +
    "getPhase(){return stateStore.get(bX)}," +
    "microphone(e){owner.applyRealtimeMicrophoneMuteState(stateStore,e)}," +
    "orb(){owner.toggleMicrophoneMute(stateStore,`conversation`)}," +
    "setBridge(e){gp=e}};" +
    "export{SX as IC};"
  );
}

function evaluate(source) {
  const context = vm.createContext({});
  const executable = source.replace(
    /export\{[A-Za-z_$][A-Za-z0-9_$]* as [A-Za-z_$][A-Za-z0-9_$]*\};$/,
    "",
  );
  new vm.Script(executable).runInContext(context);
  return context.fixture;
}

function createHarness() {
  const patchedMain = patchMainSource(mainSource(), MAIN_FILENAME);
  const patchedRenderer = patchRendererSource(
    rendererSource(),
    RENDERER_URL,
  );
  assert.equal(patchedMain.ok, true, patchedMain.reason);
  assert.equal(patchedRenderer.ok, true, patchedRenderer.reason);

  const main = evaluate(patchedMain.source);
  const renderer = evaluate(patchedRenderer.source);
  let appleMuted = null;
  let nativeRegistered = false;
  let publicationMode = "live";
  let deferControls = false;
  const deferredControls = [];
  const controls = [];

  function installBridge() {
    if (publicationMode === "absent") {
      renderer.setBridge(null);
      return;
    }
    renderer.setBridge({
      realtimeVoice: {
        publish(_claim, snapshot) {
          if (publicationMode === "broken") {
            throw new Error("owner publication failed");
          }
          main.publish("claim", snapshot);
        },
      },
    });
  }

  main.setController({
    control(command) {
      const copy = { ...command };
      controls.push(copy);
      if (deferControls) {
        deferredControls.push(copy);
        return;
      }
      renderer.control(copy);
    },
  });
  installBridge();

  const nativeGesture = {
    register() {
      nativeRegistered = true;
      return true;
    },
    synchronizeInputMuted(muted) {
      if (!nativeRegistered) return false;
      appleMuted = muted;
      return true;
    },
    unregister() {
      nativeRegistered = false;
      return true;
    },
  };
  const lifecycle = createVoiceMuteLifecycle({
    getCoordinator: () => main,
    nativeGesture,
  });
  lifecycle.tick();

  function snapshot() {
    return main.getSnapshot();
  }

  return {
    airpods(requested) {
      const accepted = lifecycle.handleRequest(requested);
      if (accepted) appleMuted = requested;
      lifecycle.tick();
      return accepted;
    },
    breakOwner() {
      main.breakOwner();
      renderer.deactivate();
      lifecycle.tick();
    },
    controls,
    footerToggle() {
      const current = snapshot();
      if (current.phase === "inactive") return false;
      return main.control(current.locator, {
        type: "set-microphone-muted",
        muted: !current.microphoneMuted,
      });
    },
    flushControls() {
      deferControls = false;
      for (const command of deferredControls.splice(0)) {
        renderer.control(command);
      }
      lifecycle.tick();
    },
    lifecycle,
    ownerCommit(muted) {
      renderer.microphone(muted);
      lifecycle.tick();
    },
    orbToggle() {
      renderer.orb();
      lifecycle.tick();
    },
    publicationHistory() {
      return Array.from(main.history);
    },
    setControlsDeferred(value) {
      deferControls = value;
    },
    setPublicationMode(mode) {
      publicationMode = mode;
      installBridge();
    },
    states() {
      const current = snapshot();
      const rendererActive =
        renderer.getPhase() === "active" ||
        renderer.getPhase() === "starting";
      const mainActive =
        current.phase === "active" ||
        current.phase === "starting";
      return {
        active: rendererActive && mainActive,
        apple: appleMuted,
        footer: mainActive ? current.microphoneMuted : null,
        main: mainActive ? current.microphoneMuted : null,
        nativeRegistered,
        orb: rendererActive ? renderer.getMuted() : null,
        owner: rendererActive ? renderer.getMuted() : null,
      };
    },
  };
}

function assertConverged(harness, muted) {
  assert.deepEqual(harness.states(), {
    active: true,
    apple: muted,
    footer: muted,
    main: muted,
    nativeRegistered: true,
    orb: muted,
    owner: muted,
  });
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("end-to-end mute convergence", () => {
  test("AirPods, orb, and footer inputs converge every visible surface", async () => {
    const app = createHarness();
    assertConverged(app, false);

    assert.equal(app.airpods(true), true);
    await flushMicrotasks();
    assertConverged(app, true);

    app.orbToggle();
    assertConverged(app, false);

    assert.equal(app.footerToggle(), true);
    app.lifecycle.tick();
    assertConverged(app, true);
  });

  test("same-state exact commands repair stale owner and main projections", async () => {
    const app = createHarness();

    app.setPublicationMode("absent");
    app.ownerCommit(true);
    assert.deepEqual(app.states(), {
      active: true,
      apple: false,
      footer: false,
      main: false,
      nativeRegistered: true,
      orb: true,
      owner: true,
    });

    app.setPublicationMode("live");
    assert.equal(
      app.airpods(false),
      true,
      "an exact command equal to stale main state must reach the owner",
    );
    await flushMicrotasks();
    assertConverged(app, false);

    app.setPublicationMode("absent");
    app.ownerCommit(true);
    app.setPublicationMode("live");
    assert.equal(
      app.airpods(true),
      true,
      "an exact command equal to owner state must republish main state",
    );
    await flushMicrotasks();
    assertConverged(app, true);
  });

  test("rapid commits remain FIFO and double footer clicks settle one target", () => {
    const app = createHarness();
    app.ownerCommit(true);
    app.ownerCommit(false);
    app.ownerCommit(true);

    assert.deepEqual(app.publicationHistory().slice(-3), [
      true,
      false,
      true,
    ]);
    assertConverged(app, true);

    app.ownerCommit(false);
    app.setControlsDeferred(true);
    assert.equal(app.footerToggle(), true);
    assert.equal(app.footerToggle(), true);
    assert.deepEqual(app.controls.slice(-2), [
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: true },
    ]);
    assertConverged(app, false);

    app.flushControls();
    assertConverged(app, true);
  });

  test("broken ownership removes active controls instead of preserving conflict", async () => {
    const app = createHarness();
    assert.equal(app.airpods(true), true);
    await flushMicrotasks();
    assertConverged(app, true);

    app.setPublicationMode("broken");
    app.orbToggle();
    app.breakOwner();

    assert.deepEqual(app.states(), {
      active: false,
      apple: true,
      footer: null,
      main: null,
      nativeRegistered: false,
      orb: null,
      owner: null,
    });
    assert.equal(app.airpods(false), false);
    assert.equal(app.footerToggle(), false);
  });
});

describe("AirPods request convergence lifecycle", () => {
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

  function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  function fakeScheduler() {
    let currentTime = 0;
    let nextId = 0;
    const scheduled = new Map();

    function setTimeoutFn(callback, delay) {
      const timer = {
        id: nextId,
        unref() {},
      };
      nextId += 1;
      scheduled.set(timer.id, {
        callback,
        time: currentTime + delay,
      });
      return timer;
    }

    function clearTimeoutFn(timer) {
      scheduled.delete(timer?.id);
    }

    function advanceTo(targetTime) {
      while (true) {
        const next = [...scheduled.entries()]
          .filter(([, entry]) => entry.time <= targetTime)
          .sort((left, right) => left[1].time - right[1].time)[0];
        if (!next) break;
        const [id, entry] = next;
        scheduled.delete(id);
        currentTime = entry.time;
        entry.callback();
      }
      currentTime = targetTime;
    }

    return {
      advanceTo,
      clearTimeoutFn,
      now: () => currentTime,
      setTimeoutFn,
      timerCount: () => scheduled.size,
    };
  }

  function harness({
    initialSnapshot = voiceSnapshot(),
    controlWithCommit = () => ({
      accepted: true,
      committed: new Promise(() => {}),
    }),
    register = () => true,
    synchronize = () => true,
    unregister = () => true,
    now = () => 0,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    retryMs = 250,
    deadlineMs = 1_000,
  } = {}) {
    let snapshot = initialSnapshot;
    const nativeCalls = [];
    const controls = [];
    const nativeGesture = {
      register() {
        nativeCalls.push(["register"]);
        return register();
      },
      unregister() {
        nativeCalls.push(["unregister"]);
        return unregister();
      },
      synchronizeInputMuted(muted) {
        nativeCalls.push(["synchronize", muted]);
        return synchronize(muted);
      },
    };
    const coordinator = {
      getSnapshot: () => snapshot,
      [CONTROL_COMMIT_SYMBOL](locator, command) {
        controls.push({ locator, command });
        return controlWithCommit(locator, command);
      },
    };
    const lifecycle = createVoiceMuteLifecycle({
      getCoordinator: () => coordinator,
      nativeGesture,
      now,
      setTimeoutFn,
      clearTimeoutFn,
      retryMs,
      deadlineMs,
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

  function callsFor(app, method) {
    return app.nativeCalls.filter(([name]) => name === method);
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
    assert.equal(app.lifecycle.handleRequest(false), false);
    assert.equal(app.controls.length, 1);
  });

  test("one reassertion occurs at 250 ms and no earlier", async () => {
    let clock = 0;
    const commits = [deferred(), deferred()];
    const app = harness({
      controlWithCommit: () => ({
        accepted: true,
        committed: commits.shift().promise,
      }),
      now: () => clock,
    });
    app.lifecycle.tick();

    assert.equal(app.lifecycle.handleRequest(true), true);
    clock = 249;
    app.lifecycle.tick();
    assert.equal(app.controls.length, 1);

    clock = 250;
    app.lifecycle.tick();
    assert.equal(app.controls.length, 2);
    clock = 900;
    app.lifecycle.tick();
    assert.equal(app.controls.length, 2);
  });

  test("the sole poll timer reaches retry and rollback deadlines", () => {
    const scheduler = fakeScheduler();
    const app = harness({
      now: scheduler.now,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });
    assert.equal(app.lifecycle.start(), true);
    assert.equal(scheduler.timerCount(), 1);

    scheduler.advanceTo(1);
    assert.equal(app.lifecycle.handleRequest(true), true);
    scheduler.advanceTo(250);
    assert.equal(app.controls.length, 1);
    scheduler.advanceTo(251);
    assert.equal(app.controls.length, 2);

    scheduler.advanceTo(1_000);
    assert.equal(
      callsFor(app, "synchronize").length,
      1,
    );
    scheduler.advanceTo(1_001);
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
      ["synchronize", false],
    ]);
    assert.equal(scheduler.timerCount(), 1);

    app.lifecycle.dispose();
    assert.equal(scheduler.timerCount(), 0);
  });

  test("registration failure at retry time resumes the normal poll cadence", () => {
    const scheduler = fakeScheduler();
    const app = harness({
      now: scheduler.now,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
      register: () => {
        const currentTime = scheduler.now();
        return currentTime < 251 || currentTime >= 351;
      },
    });
    assert.equal(app.lifecycle.start(), true);

    scheduler.advanceTo(1);
    assert.equal(app.lifecycle.handleRequest(true), true);
    scheduler.advanceTo(251);
    assert.equal(app.controls.length, 1);
    assert.equal(scheduler.timerCount(), 1);

    scheduler.advanceTo(350);
    assert.equal(app.controls.length, 1);
    scheduler.advanceTo(351);
    assert.equal(app.controls.length, 2);
    assert.equal(scheduler.timerCount(), 1);
  });

  test("an explicit failed acknowledgement triggers the sole retry immediately", async () => {
    const firstCommit = deferred();
    const secondCommit = deferred();
    const commits = [firstCommit, secondCommit];
    const app = harness({
      controlWithCommit: () => ({
        accepted: true,
        committed: commits.shift().promise,
      }),
    });
    app.lifecycle.tick();

    assert.equal(app.lifecycle.handleRequest(true), true);
    firstCommit.resolve(false);
    await flushMicrotasks();
    assert.equal(app.controls.length, 2);

    secondCommit.resolve(false);
    await flushMicrotasks();
    assert.equal(app.controls.length, 2);
    assert.equal(callsFor(app, "unregister").length, 0);
  });

  test("synchronous rejection succeeds when the immediate retry is accepted", () => {
    let attempts = 0;
    const app = harness({
      controlWithCommit: () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            accepted: false,
            committed: Promise.resolve(false),
          };
        }
        return {
          accepted: true,
          committed: new Promise(() => {}),
        };
      },
    });
    app.lifecycle.tick();

    assert.equal(app.lifecycle.handleRequest(true), true);
    assert.equal(app.controls.length, 2);
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
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
    ]);

    app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
      ["synchronize", true],
    ]);
    assert.deepEqual(app.controls, []);
  });

  test("stale snapshots are suppressed until commit acknowledgement", async () => {
    const commit = deferred();
    const app = harness({
      controlWithCommit: () => ({
        accepted: true,
        committed: commit.promise,
      }),
    });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);

    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
    ]);

    app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
    ]);

    commit.resolve(true);
    await flushMicrotasks();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
      ["synchronize", true],
    ]);

    assert.equal(app.lifecycle.handleRequest(false), true);
    assert.equal(app.controls.length, 2);
  });

  test("a new locator cannot inherit or be cleared by an old request", async () => {
    const oldCommit = deferred();
    const newCommit = deferred();
    const commits = [oldCommit, newCommit];
    const app = harness({
      controlWithCommit: () => ({
        accepted: true,
        committed: commits.shift().promise,
      }),
    });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);

    app.setSnapshot(
      voiceSnapshot({
        hostId: "replacement",
        conversationId: "other-conversation",
      }),
    );
    assert.equal(app.lifecycle.handleRequest(true), true);
    assert.equal(app.controls.length, 2);
    assert.deepEqual(app.controls[1].locator, {
      hostId: "replacement",
      conversationId: "other-conversation",
    });

    app.setSnapshot(
      voiceSnapshot({
        hostId: "replacement",
        conversationId: "other-conversation",
        microphoneMuted: true,
      }),
    );
    oldCommit.resolve(true);
    await flushMicrotasks();
    assert.equal(
      app.lifecycle.handleRequest(false),
      false,
      "the old completion must not clear the replacement request",
    );
    newCommit.resolve(true);
    await flushMicrotasks();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
      ["synchronize", true],
    ]);
  });

  test("inactive or stopping Voice unregisters, rejects, and can reconnect", () => {
    for (const phase of ["inactive", "stopping"]) {
      const app = harness();
      app.lifecycle.tick();
      app.setSnapshot(voiceSnapshot({ phase }));
      app.lifecycle.tick();

      assert.equal(app.lifecycle.handleRequest(true), false);
      assert.equal(callsFor(app, "unregister").length, 2);

      app.setSnapshot(
        voiceSnapshot({
          hostId: "replacement",
          conversationId: "reconnected",
        }),
      );
      app.lifecycle.tick();
      assert.equal(app.lifecycle.handleRequest(true), true);
    }
  });

  test("Codex rejection and exceptions do not poison the session", () => {
    for (const failure of ["reject", "throw"]) {
      let attempts = 0;
      const app = harness({
        controlWithCommit: () => {
          attempts += 1;
          if (attempts > 2) {
            return {
              accepted: true,
              committed: new Promise(() => {}),
            };
          }
          if (failure === "throw") {
            throw new Error("renderer unavailable");
          }
          return {
            accepted: false,
            committed: Promise.resolve(false),
          };
        },
      });
      app.lifecycle.tick();

      assert.equal(app.lifecycle.handleRequest(true), false);
      assert.equal(app.lifecycle.handleRequest(true), true);
      assert.equal(app.controls.length, 3);
      assert.equal(callsFor(app, "unregister").length, 0);
    }
  });

  test("timeout restores committed state and ignores late completions", async () => {
    let clock = 0;
    const first = deferred();
    const retry = deferred();
    const next = deferred();
    const commits = [first, retry, next];
    const app = harness({
      controlWithCommit: () => ({
        accepted: true,
        committed: commits.shift().promise,
      }),
      now: () => clock,
    });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);

    clock = 250;
    app.lifecycle.tick();
    assert.equal(app.controls.length, 2);

    clock = 1_001;
    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
      ["synchronize", false],
    ]);
    assert.equal(callsFor(app, "unregister").length, 0);

    assert.equal(app.lifecycle.handleRequest(true), true);
    assert.equal(app.controls.length, 3);
    first.resolve(true);
    retry.resolve(true);
    await flushMicrotasks();
    assert.equal(
      app.lifecycle.handleRequest(false),
      false,
      "an expired request cannot clear the next request",
    );

    app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
    next.resolve(true);
    await flushMicrotasks();
    assert.deepEqual(callsFor(app, "synchronize").at(-1), [
      "synchronize",
      true,
    ]);
  });

  test("an authoritative publication after timeout still synchronizes Apple", () => {
    let clock = 0;
    const app = harness({
      now: () => clock,
    });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);

    clock = 1_001;
    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize").at(-1), [
      "synchronize",
      false,
    ]);

    app.setSnapshot(voiceSnapshot({ microphoneMuted: true }));
    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize").at(-1), [
      "synchronize",
      true,
    ]);
  });

  test("a gesture after the deadline starts a fresh request before the next poll", () => {
    let clock = 0;
    const app = harness({
      now: () => clock,
    });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);

    clock = 1_001;
    assert.equal(app.lifecycle.handleRequest(false), true);
    assert.equal(app.controls.length, 2);
    assert.deepEqual(app.controls[1].command, {
      type: "set-microphone-muted",
      muted: false,
    });
  });

  test("a completion after the deadline cannot start a late retry", async () => {
    let clock = 0;
    const commit = deferred();
    const app = harness({
      controlWithCommit: () => ({
        accepted: true,
        committed: commit.promise,
      }),
      now: () => clock,
    });
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);

    clock = 1_001;
    commit.resolve(false);
    await flushMicrotasks();
    assert.equal(app.controls.length, 1);
    assert.deepEqual(callsFor(app, "synchronize").at(-1), [
      "synchronize",
      false,
    ]);
  });

  test("native registration failure is retried without disabling gestures", () => {
    let registrations = 0;
    const app = harness({
      register: () => {
        registrations += 1;
        return registrations > 1;
      },
    });

    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize"), []);
    app.lifecycle.tick();
    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
    ]);
    assert.equal(app.lifecycle.handleRequest(true), true);
    assert.equal(callsFor(app, "unregister").length, 0);
  });

  test("native mirror failure is retried without disabling gestures", () => {
    let synchronizations = 0;
    const app = harness({
      synchronize: () => {
        synchronizations += 1;
        return synchronizations > 1;
      },
    });
    app.lifecycle.tick();
    app.lifecycle.tick();

    assert.deepEqual(callsFor(app, "synchronize"), [
      ["synchronize", false],
      ["synchronize", false],
    ]);
    assert.equal(callsFor(app, "unregister").length, 0);
    assert.equal(app.lifecycle.handleRequest(true), true);
  });

  test("native unregister failure does not prevent reactivation", () => {
    const app = harness({
      unregister: () => false,
    });
    app.lifecycle.tick();
    app.setSnapshot(voiceSnapshot({ phase: "inactive" }));
    app.lifecycle.tick();

    app.setSnapshot(
      voiceSnapshot({
        hostId: "replacement",
        conversationId: "reconnected",
      }),
    );
    app.lifecycle.tick();
    assert.equal(app.lifecycle.handleRequest(true), true);
    assert.deepEqual(callsFor(app, "synchronize").at(-1), [
      "synchronize",
      false,
    ]);
  });

  test("teardown contains native unregister failures", () => {
    const app = harness({
      unregister: () => {
        throw new Error("native teardown failed");
      },
    });
    app.lifecycle.tick();

    assert.doesNotThrow(() => app.lifecycle.dispose());
    app.lifecycle.dispose();
    assert.equal(app.lifecycle.handleRequest(true), false);
    assert.deepEqual(app.nativeCalls, [
      ["register"],
      ["synchronize", false],
      ["unregister"],
    ]);
  });
});
