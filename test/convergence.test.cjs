"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const {
  patchMainSource,
} = require("../src/build-profile.cjs");
const {
  createVoiceMuteLifecycle,
} = require("../src/lifecycle.cjs");
const {
  patchRendererSource,
} = require("../src/renderer.cjs");

const MAIN_FILENAME =
  "/Applications/ChatGPT.app/Contents/Resources/app.asar/" +
  ".vite/build/main-convergence.js";
const RENDERER_URL =
  "app://-/assets/app-initial-convergence.js";

function mainSource() {
  return (
    "class Coordinator{" +
    "#session;history=[];" +
    "constructor(){this.#session={controller:null," +
    "pendingMicrophoneMuteIntents:[],pendingOutputMuteIntents:[]," +
    "snapshot:{activity:`idle`,locator:{hostId:`local`," +
    "conversationId:`conversation`},microphoneMuted:!1," +
    "outputMuted:!1,phase:`active`}}}" +
    "setController(e){this.#session.controller=e}" +
    "getSnapshot(){return this.#session.snapshot}" +
    "publish(e){let t=this.#session;" +
    "t.snapshot={...e,locator:t.snapshot.locator}," +
    "t.pendingMicrophoneMuteIntents[0]?.muted===" +
    "e.microphoneMuted&&t.pendingMicrophoneMuteIntents.shift()," +
    "t.pendingOutputMuteIntents[0]?.muted===" +
    "e.outputMuted&&t.pendingOutputMuteIntents.shift()," +
    "this.history.push(e.microphoneMuted)}" +
    "breakOwner(){let e=this.#session;e.pendingMicrophoneMuteIntents=[]," +
    "e.pendingOutputMuteIntents=[],e.snapshot={activity:`idle`," +
    "locator:null,microphoneMuted:!1,outputMuted:!1,phase:`inactive`}}" +
    "control(e,t){let n=this.#session;if(n.snapshot.phase===`inactive`" +
    "||n.snapshot.locator.hostId!==e.hostId||" +
    "n.snapshot.locator.conversationId!==e.conversationId)return!1;" +
    "switch(t.type){case`set-microphone-muted`:case`set-output-muted`:" +
    "return this.#i(n,t),!0}}" +
    "#i(e,t){let n=t.type===`set-microphone-muted`?" +
    "e.pendingMicrophoneMuteIntents:e.pendingOutputMuteIntents;" +
    "if((n.at(-1)?.muted??(t.type===`set-microphone-muted`?" +
    "e.snapshot.microphoneMuted:e.snapshot.outputMuted))===t.muted)" +
    "return;let r={...t};n.push(r),this.#a(e,n,r)}" +
    "#a(e,t,n){try{let r=e.controller.control(n);" +
    "r?.catch?.(()=>{let e=t.indexOf(n);e!==-1&&t.splice(e,1)})}" +
    "catch{let e=t.indexOf(n);e!==-1&&t.splice(e,1)}}" +
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
    "const _={microphoneMuted:!1},p={isMicrophoneMuted:!0};" +
    "const footer=_?.microphoneMuted??p.isMicrophoneMuted;void footer;" +
    "globalThis.fixture={" +
    "control(e){owner.handleRealtimeVoiceHostControl(" +
    "stateStore,`conversation`,e)}," +
    "deactivate(){stateStore.set(bX,`inactive`)}," +
    "getMuted(){return stateStore.get(SX)}," +
    "getPhase(){return stateStore.get(bX)}," +
    "microphone(e){owner.applyRealtimeMicrophoneMuteState(stateStore,e)}," +
    "orb(){owner.toggleMicrophoneMute(stateStore,`conversation`)}," +
    "setBridge(e){gp=e}};" +
    "/* export{SX as IC} */"
  );
}

function evaluate(source) {
  const context = vm.createContext({});
  new vm.Script(source).runInContext(context);
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
          main.publish(snapshot);
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
    defer: (callback) => callback(),
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

test("AirPods, orb, and footer inputs converge every visible surface", () => {
  const app = createHarness();
  assertConverged(app, false);

  assert.equal(app.airpods(true), true);
  assertConverged(app, true);

  app.orbToggle();
  assertConverged(app, false);

  assert.equal(app.footerToggle(), true);
  app.lifecycle.tick();
  assertConverged(app, true);
});

test("same-state exact commands repair stale owner and main projections", () => {
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
  assertConverged(app, false);

  app.setPublicationMode("absent");
  app.ownerCommit(true);
  app.setPublicationMode("live");
  assert.equal(
    app.airpods(true),
    true,
    "an exact command equal to owner state must republish main state",
  );
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

test("broken ownership removes active controls instead of preserving conflict", () => {
  const app = createHarness();
  assert.equal(app.airpods(true), true);
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
