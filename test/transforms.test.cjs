"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const vm = require("node:vm");
const {
  isMainBundle,
  isRendererBundle,
  patchMainSource,
  patchRendererSource,
} = require("../src/transforms.cjs");
const {
  installRendererAssetTransform,
} = require("../src/preload.cjs");

function coordinatorSource({
  continuity = "a",
  memory = "b",
  presentation = "c",
  history = "d",
  activity = "e",
  voice = "f",
  claim = "g",
  command = "h",
  queue = "i",
  intent = "j",
  controlState = "k",
  controlCommand = "l",
  owner = "#o",
  sameLocator = "same",
  claimId = "m",
  payload = "n",
  publishState = "p",
  dispatchError = "q",
  method = "#i",
  dispatch = "#a",
  prefix = "before;",
} = {}) {
  return (
    prefix +
    `class Coordinator{${owner}=null;` +
    `publish(${claimId},${payload}){let ${publishState}=this.${owner};` +
    `${publishState}?.claimId!==${claimId}||` +
    `${publishState}.cleanup!==\`none\`||(` +
    `${publishState}.snapshot={...${payload},locator:` +
    `${publishState}.snapshot.locator,preferredPresentationSurface:` +
    `${publishState}.snapshot.preferredPresentationSurface,sessionId:` +
    `${publishState}.snapshot.sessionId},` +
    `${publishState}.pendingMicrophoneMuteIntents[0]?.muted===` +
    `${payload}.microphoneMuted&&` +
    `${publishState}.pendingMicrophoneMuteIntents.shift(),` +
    `${publishState}.pendingOutputMuteIntents[0]?.muted===` +
    `${payload}.outputMuted&&` +
    `${publishState}.pendingOutputMuteIntents.shift())}` +
    `control(${controlState},${controlCommand}){let ${claim}=this.${owner};` +
    `if(${claim}==null||${claim}.cleanup!==\`none\`||` +
    `${claim}.snapshot.phase===\`stopping\`||!${sameLocator}(` +
    `${claim}.snapshot.locator,${controlState}))return!1;switch(` +
    `${controlCommand}.type){case\`set-microphone-muted\`:case` +
    `\`set-output-muted\`:return this.${method}(${claim},` +
    `${controlCommand}),!0}}controlActive(){}` +
    `${method}(${claim},${command}){let ` +
    `${queue}=${command}.type===` +
    `\`set-microphone-muted\`?${claim}.pendingMicrophoneMuteIntents:` +
    `${claim}.pendingOutputMuteIntents;if((${queue}.at(-1)?.muted??` +
    `(${command}.type===\`set-microphone-muted\`?` +
    `${claim}.snapshot.microphoneMuted:${claim}.snapshot.outputMuted))` +
    `===${command}.muted)return;let ${intent}={...${command}};` +
    `${queue}.push(${intent}),this.${dispatch}(${claim},${queue},` +
    `${intent})}async${dispatch}(${claim},${queue},${intent}){try{` +
    `await ${claim}.controller.control(${intent})}catch(${dispatchError}){` +
    `if(this.${owner}!==${claim}||${claim}.cleanup!==\`none\`)return;` +
    `let index=${queue}.indexOf(${intent});index!==-1&&` +
    `${queue}.splice(index,1)}}}` +
    `this.realtime={continuity:${continuity},memory:${memory},presentation:${presentation}.rpc,voiceHistory:${history},multiAgentActivity:${activity},voice:${voice}.rpc},this.disposables.add(${presentation}.dispose);` +
    "after"
  );
}

function mainBundle(name = "main-fixture.js") {
  return `/Applications/ChatGPT.app/Contents/Resources/app.asar/.vite/build/${name}`;
}

describe("main source transform", () => {
  test("structural source patch tolerates new bundle names and identifiers", () => {
    for (const [source, filename] of [
      [coordinatorSource(), mainBundle("main-old.js")],
      [
        coordinatorSource({
          continuity: "aa",
          memory: "$b",
          presentation: "_c",
          history: "dd",
          activity: "$$",
          voice: "voice2",
          claim: "$claim",
          command: "_command",
          queue: "$queue",
          intent: "_intent",
          controlState: "$state",
          controlCommand: "_control",
          method: "#mute",
          dispatch: "#send",
          prefix: "different-build;",
        }),
        mainBundle("main-new-build.js"),
      ],
      [
        coordinatorSource({
          prefix: "const ratio=1/2,ticks=/`/;",
        }),
        mainBundle("main-lexical-context.js"),
      ],
    ]) {
      const result = patchMainSource(source, filename);
      assert.equal(result.ok, true);
      assert.match(
        result.source,
        /Symbol\.for\("airpods-codex-mute\.voice-coordinator\.v1"\)/,
      );
      assert.match(result.source, /this\.realtime\.voice/);
      assert.match(result.source, /\.length===0&&/);
      assert.match(result.source, /control-with-commit\.v1/);
      assert.match(result.source, /commit-state\.v1/);
      assert.equal(source.includes("Symbol.for"), false);
    }
  });

  test("source patch fails closed on incompatible or ambiguous structure", () => {
    const source = coordinatorSource();
    const mismatchedOwner = source
      .replace("#o=null;", "#o=null;#other=null;")
      .replace(
        "publish(m,n){let p=this.#o;",
        "publish(m,n){let p=this.#other;",
      );
    const mismatchedDispatchOwner = source
      .replace("#o=null;", "#o=null;#other=null;")
      .replace(
        "catch(q){if(this.#o!==g",
        "catch(q){if(this.#other!==g",
      );
    const splitAcrossClasses = source.replace(
      "control(k,l){",
      "}class Other{#o=null;control(k,l){",
    );
    const commentedSplitAcrossClasses = source.replace(
      "control(k,l){",
      "}class/**/Other{#o=null;control(k,l){",
    );
    const coordinatorExpression =
      "this.realtime={continuity:a,memory:b,presentation:c.rpc," +
      "voiceHistory:d,multiAgentActivity:e,voice:f.rpc}," +
      "this.disposables.add(c.dispose);";
    const commentedCoordinator = source.replace(
      coordinatorExpression,
      `/*${coordinatorExpression}*/`,
    );
    for (const candidate of [
      ["not JavaScript", mainBundle()],
      [source + source, mainBundle()],
      [mismatchedOwner, mainBundle()],
      [mismatchedDispatchOwner, mainBundle()],
      [splitAcrossClasses, mainBundle()],
      [commentedSplitAcrossClasses, mainBundle()],
      [commentedCoordinator, mainBundle()],
      [source, "/tmp/main-fixture.js"],
    ]) {
      const result = patchMainSource(...candidate);
      assert.equal(result.ok, false);
      assert.equal(result.source, candidate[0]);
    }

    const patched = patchMainSource(source, mainBundle());
    assert.equal(
      patchMainSource(patched.source, mainBundle()).ok,
      false,
    );
  });

  test("class-like text in comments does not split a valid flow", () => {
    const source = coordinatorSource().replace(
      "control(k,l){",
      "/* class Fake{ */control(k,l){",
    );

    assert.equal(patchMainSource(source, mainBundle()).ok, true);
  });

  test("non-code coordinator shapes cannot satisfy structural gates", () => {
    const payload = coordinatorSource({ prefix: "void 0;" });
    let templateExpression = payload.replace(
      "control(k,l){",
      "static x=`${class Other{#o=null;control(k,l){",
    );
    templateExpression = templateExpression.replace(
      "i.splice(index,1)}}}this.realtime",
      "i.splice(index,1)}}}}`;}this.realtime",
    );
    for (const decoy of [
      `class Wrapper{field='${payload}'}`,
      `class Wrapper{/*${payload}*/}`,
      `class Wrapper{field=/${payload}/}`,
      `if(0)/${payload}/;`,
      `if(0){}/${payload}/;`,
      `label:{}/${payload}/;`,
      `async function f(){for await(const x of [])/${payload}/;}`,
      `switch(0){case 0:{}/${payload}/;}`,
      `const x=1\nlabel:{}/${payload}/;`,
      `const x=1/*\n*/label:{}/${payload}/;`,
      `function f(){return\nlabel:{}/${payload}/;}`,
      templateExpression,
    ]) {
      new vm.Script(decoy);
      const result = patchMainSource(decoy, mainBundle());
      assert.equal(result.ok, false);
      assert.equal(result.source, decoy);
    }
  });

  test("property calls named like control keywords preserve code context", () => {
    const payload = coordinatorSource({ prefix: "" });
    const marker = "}this.realtime=";
    const split = payload.indexOf(marker);
    const ownerClass = payload.slice(0, split + 1);
    const remainder = payload.slice(split + 1);

    for (const keyword of ["catch", "if", "while"]) {
      const source =
        `obj.${keyword}(0)/(${ownerClass})/g;${remainder}`;
      new vm.Script(source);
      const result = patchMainSource(source, mainBundle());
      assert.equal(result.ok, true, result.reason);
      new vm.Script(result.source);
    }
  });

  test("capture accepts only the coordinator carrying the commit operation", () => {
    const prefix =
      "var a={},b={},c={rpc:{},dispose(){}},d={},e={}," +
      "f={rpc:globalThis.candidate},after;" +
      "this.disposables={add(){}};";
    const result = patchMainSource(
      coordinatorSource({ prefix }),
      mainBundle(),
    );
    assert.equal(result.ok, true, result.reason);

    for (const carriesCommitOperation of [false, true]) {
      const context = vm.createContext({});
      const candidate = {
        control() {},
        getSnapshot() {
          return {};
        },
      };
      if (carriesCommitOperation) {
        candidate[
          Symbol.for("airpods-codex-mute.control-with-commit.v1")
        ] = () => {};
      }
      context.candidate = candidate;
      context[
        Symbol.for("airpods-codex-mute.voice-coordinator.v1")
      ] = (value) => {
        context.captured = value;
      };

      new vm.Script(result.source).runInContext(context);
      assert.equal(
        context.captured,
        carriesCommitOperation ? candidate : null,
      );
    }
  });

  test("main bundle matcher accepts changing Vite bundle names only", () => {
    assert.equal(isMainBundle(mainBundle("main-a1b2c3.js")), true);
    assert.equal(isMainBundle(mainBundle("main-next.js")), true);
    assert.equal(isMainBundle(mainBundle("worker-next.js")), false);
    assert.equal(isMainBundle("/tmp/main-next.js"), false);
  });

  test("microphone acknowledgement waits for renderer RPC and main publication", async () => {
    const source =
      "function same(e,t){return e.hostId===t.hostId&&" +
      "e.conversationId===t.conversationId}" +
      "class Coordinator{#session;sent=[];pending=[];" +
      "constructor(){this.#session={claimId:`claim`,cleanup:`none`," +
      "controller:{control:e=>(this.sent.push({...e}),new Promise(" +
      "((t,n)=>this.pending.push({resolve:t,reject:n}))))}," +
      "pendingMicrophoneMuteIntents:[],pendingOutputMuteIntents:[]," +
      "published:!0,snapshot:{activity:`idle`,locator:{hostId:`local`," +
      "conversationId:`conversation`},microphoneMuted:!1," +
      "outputMuted:!1,phase:`active`,preferredPresentationSurface:null," +
      "sessionId:null}}}" +
      "publish(e,t){let n=this.#session;n?.claimId!==e||" +
      "n.cleanup!==`none`||(n.snapshot={...t,locator:n.snapshot.locator," +
      "preferredPresentationSurface:n.snapshot.preferredPresentationSurface," +
      "sessionId:n.snapshot.sessionId}," +
      "n.pendingMicrophoneMuteIntents[0]?.muted===t.microphoneMuted&&" +
      "n.pendingMicrophoneMuteIntents.shift()," +
      "n.pendingOutputMuteIntents[0]?.muted===t.outputMuted&&" +
      "n.pendingOutputMuteIntents.shift(),n.published=!0)}" +
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
      "getSnapshot(){return this.#session.snapshot}" +
      "setLocator(e){this.#session.snapshot.locator=e}" +
      "resolve(e){this.pending[e].resolve()}" +
      "reject(e){this.pending[e].reject(Error(`rejected`))}" +
      "}" +
      "class App{constructor(a,b,c,d,e,f){this.disposables={add(){}}," +
      "this.realtime={continuity:a,memory:b," +
      "presentation:c.rpc,voiceHistory:d,multiAgentActivity:e," +
      "voice:f.rpc},this.disposables.add(c.dispose)}}" +
      "let dependency={rpc:{},dispose(){}};" +
      "let coordinator=new Coordinator;" +
      "new App({},{},dependency,{}, {},{rpc:coordinator});" +
      "globalThis.fixture=coordinator;";
    const result = patchMainSource(source, mainBundle());
    assert.equal(result.ok, true, result.reason);

    const context = vm.createContext({});
    new vm.Script(result.source).runInContext(context);
    const coordinator = context.fixture;
    const locator = { hostId: "local", conversationId: "conversation" };
    const operation = coordinator[
      Symbol.for("airpods-codex-mute.control-with-commit.v1")
    ].bind(coordinator);
    const first = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    assert.equal(first.accepted, true);
    let firstSettled = false;
    void first.committed.then(() => { firstSettled = true; });

    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });
    await Promise.resolve();
    assert.equal(firstSettled, false);
    coordinator.resolve(0);
    assert.equal(await first.committed, true);

    const second = operation(locator, {
      type: "set-microphone-muted", muted: false,
    });
    let secondSettled = false;
    void second.committed.then(() => { secondSettled = true; });
    coordinator.resolve(1);
    await Promise.resolve();
    assert.equal(secondSettled, false);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: false,
      outputMuted: false, phase: "active",
    });
    assert.equal(await second.committed, true);

    const stalled = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    const retry = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    coordinator.reject(2);
    assert.equal(await stalled.committed, false);
    coordinator.resolve(3);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });
    assert.equal(await retry.committed, true);

    assert.equal(coordinator.control(locator, {
      type: "set-microphone-muted", muted: false,
    }), true);
    const afterStock = operation(locator, {
      type: "set-microphone-muted", muted: false,
    });
    coordinator.reject(4);
    coordinator.resolve(5);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: false,
      outputMuted: false, phase: "active",
    });
    assert.equal(await afterStock.committed, true);

    assert.equal(coordinator.control(locator, {
      type: "set-microphone-muted", muted: true,
    }), true);
    const failedAlongsideStock = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    coordinator.reject(7);
    assert.equal(await failedAlongsideStock.committed, false);
    const retryAlongsideStock = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    coordinator.resolve(6);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });
    coordinator.resolve(8);
    assert.equal(await retryAlongsideStock.committed, true);

    const wrongTarget = operation(locator, {
      type: "set-microphone-muted", muted: false,
    });
    let wrongTargetSettled = false;
    void wrongTarget.committed.then(() => {
      wrongTargetSettled = true;
    });
    coordinator.resolve(9);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });
    await Promise.resolve();
    assert.equal(wrongTargetSettled, false);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: false,
      outputMuted: false, phase: "active",
    });
    assert.equal(await wrongTarget.committed, true);

    const inactiveSettlement = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    coordinator.resolve(10);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "inactive",
    });
    assert.equal(await inactiveSettlement.committed, false);
    const rejectedInactive = operation(locator, {
      type: "set-microphone-muted", muted: false,
    });
    assert.equal(rejectedInactive.accepted, false);
    assert.equal(await rejectedInactive.committed, false);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });

    const stopping = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    coordinator.resolve(11);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "stopping",
    });
    assert.equal(await stopping.committed, false);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });

    const replacedLocator = operation(locator, {
      type: "set-microphone-muted", muted: true,
    });
    coordinator.resolve(12);
    coordinator.publish("claim", {
      activity: "idle", microphoneMuted: true,
      outputMuted: false, phase: "active",
    });
    coordinator.setLocator({
      hostId: "replacement",
      conversationId: "replacement",
    });
    assert.equal(await replacedLocator.committed, false);

    assert.deepEqual(Array.from(coordinator.sent, (command) => ({
      type: command.type, muted: command.muted,
    })), [
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: false },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: false },
      { type: "set-microphone-muted", muted: false },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: false },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: true },
      { type: "set-microphone-muted", muted: true },
    ]);
  });
});

const TARGET_URL = "app://-/assets/app-initial-fixture.js";

function rendererSource({
  activityAtom = "CX",
  bridge = "gp",
  cache = "#n",
  claim = "#t",
  command = "n",
  conversation = "t",
  error = "e",
  feedback = null,
  guard = "up",
  local = "p",
  main = "_",
  microphoneAtom = "SX",
  muted = "t",
  next = "n",
  outputAtom = "xX",
  payload = "e",
  phase = "t",
  phaseAtom = "bX",
  previous = "n",
  scope = "t",
  store = "e",
} = {}) {
  return (
    `let ${bridge}=null;` +
    `function ${guard}(){return{u(){},e:null,d(){}}}` +
    (feedback == null
      ? ""
      : `const feedbackCalls=[];function ${feedback}(e){` +
        `feedbackCalls.push(e)}`) +
    `class Claim{${claim}=\`claim\`;${cache}=null;` +
    `publish(${payload}){try{var ${scope}=${guard}();` +
    `if(this.${claim}==null)return;let ${previous}=this.${cache};` +
    `if(${previous}!=null&&` +
    `${previous}.activity===${payload}.activity&&` +
    `${previous}.microphoneMuted===${payload}.microphoneMuted&&` +
    `${previous}.outputMuted===${payload}.outputMuted&&` +
    `${previous}.phase===${payload}.phase)return;` +
    `this.${cache}=${payload},${scope}.u(` +
    `${bridge}?.realtimeVoice?.publish(this.${claim},${payload}))` +
    `}catch(${error}){${scope}.e=${error}}finally{${scope}.d()}}}` +
    `const ${phaseAtom}={},${activityAtom}={},` +
    `${microphoneAtom}={},${outputAtom}={};` +
    `const values=new Map([[${phaseAtom},\`active\`],` +
    `[${activityAtom},\`listening\`],[${microphoneAtom},!1],` +
    `[${outputAtom},!1]]);` +
    `const stateStore={get(e){return values.get(e)},` +
    `set(e,t){values.set(e,t)}};` +
    `const claimInstance=new Claim;` +
    `class Owner{constructor(){this.conversationId=\`conversation\`;` +
    `this.runtime={inputCalls:[],setInputMuted(e){` +
    `this.inputCalls.push(e)}};this.realtimeVoiceHostClaim=` +
    `claimInstance;this.orbUpdates=0}` +
    `toggleMicrophoneMute(${store},${conversation}){if(` +
    `this.conversationId!==${conversation}||` +
    `${store}.get(${phaseAtom})!==\`starting\`&&` +
    `${store}.get(${phaseAtom})!==\`active\`||` +
    `this.runtime==null)return;let ${next}=!` +
    `${store}.get(${microphoneAtom});` +
    `this.applyRealtimeMicrophoneMuteState(${store},${next})}` +
    `applyRealtimeMicrophoneMuteState(${store},${muted}){` +
    `this.runtime?.setInputMuted(${muted}),` +
    `${store}.set(${microphoneAtom},${muted}),` +
    (feedback == null ? "" : `${feedback}(${muted}),`) +
    `this.publishRealtimeVoiceHostState(${store})}` +
    `handleRealtimeVoiceHostControl(${store},t,${command}){` +
    `if(this.conversationId===t)switch(${command}.type){` +
    `case\`set-microphone-muted\`:` +
    `${store}.get(${microphoneAtom})!==${command}.muted&&` +
    `this.applyRealtimeMicrophoneMuteState(` +
    `${store},${command}.muted);break;}}` +
    `publishRealtimeVoiceHostState(${store}){let ${phase}=` +
    `${store}.get(${phaseAtom});${phase}!==\`inactive\`&&(` +
    `this.realtimeVoiceHostClaim.publish({activity:` +
    `${store}.get(${activityAtom}),microphoneMuted:` +
    `${store}.get(${microphoneAtom}),outputMuted:` +
    `${store}.get(${outputAtom}),phase:${phase}}),` +
    `this.updateRealtimeVoiceOrbAudioStream())}` +
    `updateRealtimeVoiceOrbAudioStream(){this.orbUpdates+=1}}` +
    `const owner=new Owner;` +
    `const snapshot={microphoneMuted:!1,outputMuted:!1,` +
    `phase:\`active\`,locator:{conversationId:\`conversation\`,` +
    `hostId:\`local\`}},conversationId=\`conversation\`,` +
    `hostId=\`local\`,unavailable=!1,` +
    `${local}={isMicrophoneMuted:!0,isMuted:!1,phase:\`active\`};` +
    `const ${main}=snapshot.phase!==\`inactive\`&&` +
    `conversationId!=null&&snapshot.locator.conversationId===` +
    `conversationId&&snapshot.locator.hostId===hostId?snapshot:null,` +
    `footerPhase=unavailable?\`inactive\`:` +
    `${main}?.phase??${local}.phase,` +
    `footerOutput=${main}?.outputMuted??${local}.isMuted,` +
    `footer=${main}?.microphoneMuted??` +
    `${local}.isMicrophoneMuted;` +
    `void footerPhase;void footerOutput;void footer;` +
    `globalThis.fixture={` +
    `control(e){owner.handleRealtimeVoiceHostControl(` +
    `stateStore,\`conversation\`,e)},` +
    `getInputCalls(){return[...owner.runtime.inputCalls]},` +
    `getFeedbackCalls(){return` +
    (feedback == null ? `[]` : `[...feedbackCalls]`) +
    `},` +
    `getMuted(){return stateStore.get(${microphoneAtom})},` +
    `microphone(e){owner.applyRealtimeMicrophoneMuteState(` +
    `stateStore,e)},` +
    `orb(){owner.toggleMicrophoneMute(stateStore,\`conversation\`)},` +
    `publish(e,t){claimInstance.publish(e,t)},` +
    `publishOwner(){owner.publishRealtimeVoiceHostState(stateStore)},` +
    `setBridge(e){${bridge}=e},setRuntime(e){owner.runtime=e}};` +
    `export{${microphoneAtom} as IC};`
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

function protocolHarness() {
  const handlers = new Map();
  const registrations = [];
  let unhandleCalls = 0;
  const protocol = {
    handle(scheme, handler) {
      registrations.push(scheme);
      handlers.set(scheme, handler);
      return `registered:${scheme}`;
    },
    unhandle() {
      unhandleCalls += 1;
    },
  };
  return {
    handlers,
    protocol,
    registrations,
    get unhandleCalls() {
      return unhandleCalls;
    },
  };
}

describe("renderer source transform", () => {
  test("renderer matcher accepts identifier and asset hash churn", () => {
    for (const [source, filename] of [
      [rendererSource(), TARGET_URL],
      [
        "const ratio=1/2,ticks=/`/;" + rendererSource(),
        "app://-/assets/app-initial-lexical-context.js",
      ],
      [
        rendererSource({
          activityAtom: "$activity",
          bridge: "_bridge",
          cache: "#cached",
          claim: "#claim",
          command: "$command",
          conversation: "_conversation",
          error: "$error",
          guard: "$guard",
          local: "$local",
          main: "$main",
          microphoneAtom: "_microphone",
          muted: "$muted",
          next: "$next",
          outputAtom: "$output",
          payload: "$payload",
          phase: "$phase",
          phaseAtom: "_phase",
          previous: "$previous",
          scope: "_scope",
          store: "$store",
        }),
        "app://-/assets/app-initial-next-build-A9.js",
      ],
    ]) {
      const result = patchRendererSource(source, filename);
      assert.equal(result.ok, true, result.reason);
      assert.match(result.source, /__airpodsForce/);
      assert.match(result.source, /__airpodsBridge/);
    }
  });

  test("renderer patch fails closed on incompatible or ambiguous shapes", () => {
    const source = rendererSource();
    const exportStatement = "export{SX as IC};";
    const rendererBody = source.slice(0, -exportStatement.length);
    const regexBody = rendererBody.replaceAll("/", "\\/");
    const splitAcrossClasses = source.replace(
      "applyRealtimeMicrophoneMuteState(e,t){",
      "}class Other{applyRealtimeMicrophoneMuteState(e,t){",
    );
    const candidates = [
      ["not JavaScript", TARGET_URL],
      [source + source, TARGET_URL],
      [`const decoy='${source}'`, TARGET_URL],
      [`//${source}\nvoid 0;`, TARGET_URL],
      [`if(0)/${regexBody}/;${exportStatement}`, TARGET_URL],
      [`if(0){}/${regexBody}/;${exportStatement}`, TARGET_URL],
      [
        `const SX=0;label:{}/${regexBody}/;${exportStatement}`,
        TARGET_URL,
      ],
      [
        `const SX=0;async function f(){for await(const x of [])` +
          `/${regexBody}/;}${exportStatement}`,
        TARGET_URL,
      ],
      [
        `const SX=0;switch(0){case 0:{}/${regexBody}/;}` +
          exportStatement,
        TARGET_URL,
      ],
      [
        `const SX=0;const x=1\nlabel:{}/${regexBody}/;` +
          exportStatement,
        TARGET_URL,
      ],
      [
        `const SX=0;const x=1/*\n*/label:{}/${regexBody}/;` +
          exportStatement,
        TARGET_URL,
      ],
      [
        `const SX=0;function f(){return\nlabel:{}/${regexBody}/;}` +
          exportStatement,
        TARGET_URL,
      ],
      [splitAcrossClasses, TARGET_URL],
      [
        source.replace(
          "microphoneMuted??p.isMicrophoneMuted",
          "microphoneMuted??p.otherState",
        ),
        TARGET_URL,
      ],
      [
        source.replace(
          "toggleMicrophoneMute(e,t)",
          "toggleOtherControl(e,t)",
        ),
        TARGET_URL,
      ],
      [
        source.replace("export{SX as IC}", "export{xX as IC}"),
        TARGET_URL,
      ],
      [
        source.replace(
          exportStatement,
          `/* ${exportStatement} */`,
        ),
        TARGET_URL,
      ],
      [source, "app://-/assets/other-fixture.js"],
    ];
    for (const candidate of candidates) {
      const result = patchRendererSource(...candidate);
      assert.equal(result.ok, false);
      assert.equal(result.source, candidate[0]);
    }

    const patched = patchRendererSource(source, TARGET_URL);
    assert.equal(patched.ok, true);
    assert.equal(
      patchRendererSource(patched.source, TARGET_URL).reason,
      "already-patched",
    );
  });

  test("renderer patch forces microphone commits without weakening other dedupe", () => {
    const result = patchRendererSource(rendererSource(), TARGET_URL);
    assert.equal(result.ok, true, result.reason);
    assert.equal(
      result.source.match(
        /publishRealtimeVoiceHostState\([^)]*,!0\)/g,
      )?.length,
      1,
    );

    const fixture = evaluate(result.source);
    const published = [];
    const state = {
      activity: "listening",
      microphoneMuted: false,
      outputMuted: false,
      phase: "active",
    };

    fixture.publish(state);
    fixture.setBridge({
      realtimeVoice: {
        publish(claim, snapshot) {
          published.push({ claim, ...snapshot });
        },
      },
    });
    fixture.publish({ ...state });
    assert.equal(
      published.length,
      1,
      "a missing bridge must not poison the publication cache",
    );

    fixture.publish({ ...state });
    fixture.publishOwner();
    assert.equal(
      published.length,
      1,
      "ordinary unchanged publications remain deduplicated",
    );

    fixture.control({
      type: "set-microphone-muted",
      muted: false,
    });
    assert.equal(
      published.length,
      2,
      "a same-state exact command repairs the main mirror",
    );
    assert.deepEqual(Array.from(fixture.getInputCalls()), [false]);

    fixture.microphone(true);
    fixture.microphone(false);
    fixture.microphone(true);
    assert.deepEqual(
      published.slice(-3).map((item) => item.microphoneMuted),
      [true, false, true],
    );

    fixture.orb();
    assert.equal(fixture.getMuted(), false);
    assert.equal(published.at(-1).microphoneMuted, false);

    const unavailable = evaluate(result.source);
    unavailable.setRuntime(null);
    assert.throws(() => unavailable.control({
      type: "set-microphone-muted", muted: true,
    }));
    assert.equal(unavailable.getMuted(), false);

    const throwing = evaluate(result.source);
    throwing.setRuntime({
      setInputMuted() {
        throw new Error("track setter failed");
      },
    });
    assert.throws(() => throwing.control({
      type: "set-microphone-muted", muted: true,
    }), /track setter failed/);
    assert.equal(throwing.getMuted(), false);
  });

  test("renderer patch preserves stock microphone feedback", () => {
    const source = rendererSource({ feedback: "playFeedback" });
    const result = patchRendererSource(source, TARGET_URL);
    assert.equal(result.ok, true, result.reason);
    assert.match(
      result.source,
      /\.set\(SX,t\),playFeedback\(t\),this\.publishRealtimeVoiceHostState\(e,!0\)/,
    );

    const fixture = evaluate(result.source);
    fixture.control({
      type: "set-microphone-muted",
      muted: false,
    });
    fixture.microphone(true);
    assert.deepEqual(
      Array.from(fixture.getFeedbackCalls()),
      [false, true],
    );

    for (const incompatible of [
      source.replace(
        "playFeedback(t),this.publishRealtimeVoiceHostState(e)",
        "playFeedback(t),playFeedback(t)," +
          "this.publishRealtimeVoiceHostState(e)",
      ),
      source.replace("playFeedback(t)", "playFeedback(!t)"),
      source.replace(
        "playFeedback(t),this.publishRealtimeVoiceHostState(e)",
        "this.publishRealtimeVoiceHostState(e),playFeedback(t)",
      ),
    ]) {
      const rejected = patchRendererSource(incompatible, TARGET_URL);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.source, incompatible);
    }
  });

  test("renderer bundle matcher accepts only the intended asset family", () => {
    assert.equal(isRendererBundle(TARGET_URL), true);
    assert.equal(
      isRendererBundle(
        "/Applications/ChatGPT.app/Contents/Resources/app.asar/" +
          "webview/assets/app-initial-hash.js",
      ),
      true,
    );
    assert.equal(
      isRendererBundle("app://-/assets/app-initial-hash.css"),
      false,
    );
    assert.equal(
      isRendererBundle("app://-/assets/worker-initial-hash.js"),
      false,
    );
  });
});

describe("renderer protocol transform", () => {
  test("protocol wrapper patches targets and preserves stock behavior", async () => {
    const harness = protocolHarness();
    const originalHandle = harness.protocol.handle;
    let readySettled = false;
    const installed = installRendererAssetTransform({
      protocol: harness.protocol,
    });
    installed.ready.then(() => {
      readySettled = true;
    });

    const unrelatedHandler = () => new Response("unrelated");
    assert.equal(
      harness.protocol.handle("file", unrelatedHandler),
      "registered:file",
    );
    assert.equal(harness.handlers.get("file"), unrelatedHandler);
    assert.equal(readySettled, false);

    let lastStockResponse;
    const stockHandler = async (request) => {
      const body = request.url === TARGET_URL
        ? rendererSource()
        : "stock";
      lastStockResponse = new Response(body, {
        headers: {
          "content-length": String(Buffer.byteLength(body)),
          "content-type": "text/javascript",
          "x-stock": "preserved",
        },
        status: 203,
        statusText: "Stock",
      });
      return lastStockResponse;
    };
    assert.equal(
      harness.protocol.handle("app", stockHandler),
      "registered:app",
    );
    assert.equal(harness.protocol.handle, originalHandle);

    const appHandler = harness.handlers.get("app");
    const nonTarget = await appHandler({
      url: "app://-/assets/other.js",
    });
    assert.equal(nonTarget, lastStockResponse);
    assert.equal(await nonTarget.text(), "stock");

    const transformed = await appHandler({ url: TARGET_URL });
    assert.notEqual(transformed, lastStockResponse);
    assert.equal(transformed.status, 203);
    assert.equal(transformed.statusText, "Stock");
    assert.equal(transformed.headers.get("x-stock"), "preserved");
    assert.equal(transformed.headers.get("content-type"), "text/javascript");
    assert.equal(transformed.headers.get("content-length"), null);
    assert.match(await transformed.text(), /__airpodsForce/);
    assert.equal(await installed.ready, true);

    const reloaded = await appHandler({ url: TARGET_URL });
    assert.match(await reloaded.text(), /__airpodsForce/);
    installed.dispose();
    assert.equal(harness.unhandleCalls, 0);
  });

  test("target failure serves untouched stock bytes and reports once", async () => {
    const harness = protocolHarness();
    const failures = [];
    const installed = installRendererAssetTransform(
      { protocol: harness.protocol },
      {
        onFailure(reason) {
          failures.push(reason);
        },
      },
    );
    let stockResponse;
    let requestCount = 0;
    harness.protocol.handle("app", async () => {
      requestCount += 1;
      const body = requestCount === 1
        ? "unrecognized stock bytes"
        : rendererSource();
      stockResponse = new Response(body, {
        headers: {
          "content-length": String(Buffer.byteLength(body)),
          "x-stock": "yes",
        },
      });
      return stockResponse;
    });

    const appHandler = harness.handlers.get("app");
    const first = await appHandler({ url: TARGET_URL });
    assert.equal(first, stockResponse);
    assert.equal(await first.text(), "unrecognized stock bytes");
    assert.equal(first.headers.get("content-length"), "24");
    assert.equal(await installed.ready, false);
    assert.deepEqual(failures, ["renderer-shape-mismatch"]);

    const laterCompatible = await appHandler({ url: TARGET_URL });
    assert.equal(laterCompatible, stockResponse);
    assert.doesNotMatch(await laterCompatible.text(), /__airpodsForce/);
    assert.deepEqual(failures, ["renderer-shape-mismatch"]);
  });

  test("a later target failure is reported after readiness", async () => {
    const harness = protocolHarness();
    const failures = [];
    const installed = installRendererAssetTransform(
      { protocol: harness.protocol },
      {
        onFailure(reason) {
          failures.push(reason);
        },
      },
    );
    let requestCount = 0;
    let stockResponse;
    harness.protocol.handle("app", async () => {
      requestCount += 1;
      const source = requestCount === 2
        ? "new incompatible source"
        : rendererSource();
      stockResponse = new Response(source);
      return stockResponse;
    });
    const appHandler = harness.handlers.get("app");

    const transformed = await appHandler({ url: TARGET_URL });
    assert.match(await transformed.text(), /__airpodsForce/);
    assert.equal(await installed.ready, true);
    assert.deepEqual(failures, []);

    const fallback = await appHandler({ url: TARGET_URL });
    assert.equal(fallback, stockResponse);
    assert.equal(await fallback.text(), "new incompatible source");
    assert.deepEqual(failures, ["renderer-shape-mismatch"]);

    const laterCompatible = await appHandler({ url: TARGET_URL });
    assert.equal(laterCompatible, stockResponse);
    assert.doesNotMatch(await laterCompatible.text(), /__airpodsForce/);
    assert.deepEqual(failures, ["renderer-shape-mismatch"]);
  });

  test("an in-flight transform cannot escape sticky incompatibility", async () => {
    const harness = protocolHarness();
    const failures = [];
    let releaseCompatible;
    const compatibleText = new Promise((resolve) => {
      releaseCompatible = resolve;
    });
    const compatibleStock = {
      clone: () => ({ text: () => compatibleText }),
      headers: new Headers(),
      status: 200,
      statusText: "OK",
      text() {},
    };
    const incompatibleStock = new Response("incompatible");
    const installed = installRendererAssetTransform(
      { protocol: harness.protocol },
      {
        onFailure(reason) {
          failures.push(reason);
        },
      },
    );
    harness.protocol.handle("app", async (request) =>
      request.compatible ? compatibleStock : incompatibleStock);
    const appHandler = harness.handlers.get("app");

    const inFlight = appHandler({
      url: TARGET_URL,
      compatible: true,
    });
    const failed = await appHandler({
      url: TARGET_URL,
      compatible: false,
    });
    assert.equal(failed, incompatibleStock);
    assert.deepEqual(failures, ["renderer-shape-mismatch"]);

    releaseCompatible(rendererSource());
    assert.equal(await inFlight, compatibleStock);
    assert.equal(await installed.ready, false);
  });

  test("a target stock-handler rejection fails readiness without masking it", async () => {
    const harness = protocolHarness();
    const failures = [];
    const installed = installRendererAssetTransform(
      { protocol: harness.protocol },
      {
        onFailure(reason) {
          failures.push(reason);
        },
      },
    );
    const stockError = new Error("stock failed");
    harness.protocol.handle("app", async () => {
      throw stockError;
    });

    await assert.rejects(
      harness.handlers.get("app")({ url: TARGET_URL }),
      (error) => error === stockError,
    );
    assert.equal(await installed.ready, false);
    assert.deepEqual(failures, ["stock-handler-failed"]);
  });

  test("dispose restores a pending hook and leaves a registered handler stock", async () => {
    const pendingHarness = protocolHarness();
    const pendingOriginal = pendingHarness.protocol.handle;
    const pending = installRendererAssetTransform({
      protocol: pendingHarness.protocol,
    });
    assert.notEqual(pendingHarness.protocol.handle, pendingOriginal);
    pending.dispose();
    assert.equal(pendingHarness.protocol.handle, pendingOriginal);
    assert.equal(await pending.ready, false);

    const activeHarness = protocolHarness();
    const active = installRendererAssetTransform({
      protocol: activeHarness.protocol,
    });
    let stockResponse;
    activeHarness.protocol.handle("app", async () => {
      stockResponse = new Response(rendererSource());
      return stockResponse;
    });
    const appHandler = activeHarness.handlers.get("app");
    const transformed = await appHandler({ url: TARGET_URL });
    assert.match(await transformed.text(), /__airpodsForce/);
    assert.equal(await active.ready, true);

    active.dispose();
    const delegated = await appHandler({ url: TARGET_URL });
    assert.equal(delegated, stockResponse);
    assert.equal(await delegated.text(), rendererSource());
    assert.equal(activeHarness.unhandleCalls, 0);
  });
});
