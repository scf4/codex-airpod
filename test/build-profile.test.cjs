"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const {
  isMainBundle,
  patchMainSource,
} = require("../src/build-profile.cjs");

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
  method = "#i",
  dispatch = "#a",
  prefix = "before;",
} = {}) {
  return (
    prefix +
    `this.realtime={continuity:${continuity},memory:${memory},presentation:${presentation}.rpc,voiceHistory:${history},multiAgentActivity:${activity},voice:${voice}.rpc},this.disposables.add(${presentation}.dispose);` +
    `control(${controlState},${controlCommand}){switch(` +
    `${controlCommand}.type){case\`set-microphone-muted\`:case` +
    `\`set-output-muted\`:return this.${method}(${controlState},` +
    `${controlCommand}),!0}}${method}(${claim},${command}){let ` +
    `${queue}=${command}.type===` +
    `\`set-microphone-muted\`?${claim}.pendingMicrophoneMuteIntents:` +
    `${claim}.pendingOutputMuteIntents;if((${queue}.at(-1)?.muted??` +
    `(${command}.type===\`set-microphone-muted\`?` +
    `${claim}.snapshot.microphoneMuted:${claim}.snapshot.outputMuted))` +
    `===${command}.muted)return;let ${intent}={...${command}};` +
    `${queue}.push(${intent}),this.${dispatch}(${claim},${queue},` +
    `${intent})};after`
  );
}

function mainBundle(name = "main-fixture.js") {
  return `/Applications/ChatGPT.app/Contents/Resources/app.asar/.vite/build/${name}`;
}

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
  ]) {
    const result = patchMainSource(source, filename);
    assert.equal(result.ok, true);
    assert.match(
      result.source,
      /Symbol\.for\("airpods-codex-mute\.voice-coordinator\.v1"\)/,
    );
    assert.match(result.source, /this\.realtime\.voice/);
    assert.match(result.source, /\.length===0&&/);
    assert.match(
      result.source,
      /\.at\(-1\)\);return}if\(/,
    );
    assert.equal(source.includes("Symbol.for"), false);
  }
});

test("source patch fails closed on incompatible or ambiguous structure", () => {
  const source = coordinatorSource();
  for (const candidate of [
    ["not JavaScript", mainBundle()],
    [source + source, mainBundle()],
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

test("main bundle matcher accepts changing Vite bundle names only", () => {
  assert.equal(isMainBundle(mainBundle("main-a1b2c3.js")), true);
  assert.equal(isMainBundle(mainBundle("main-next.js")), true);
  assert.equal(isMainBundle(mainBundle("worker-next.js")), false);
  assert.equal(isMainBundle("/tmp/main-next.js"), false);
});

test("every exact microphone control reaches the owner", () => {
  const source =
    "class Coordinator{" +
    "disposables={add(){}};sent=[];" +
    "#a(e,t,n){this.sent.push({intent:n,queueLength:t.length})}" +
    "#i(e,t){let n=t.type===`set-microphone-muted`?" +
    "e.pendingMicrophoneMuteIntents:e.pendingOutputMuteIntents;" +
    "if((n.at(-1)?.muted??(t.type===`set-microphone-muted`?" +
    "e.snapshot.microphoneMuted:e.snapshot.outputMuted))===t.muted)" +
    "return;let r={...t};n.push(r),this.#a(e,n,r)}" +
    "constructor(a,b,c,d,e,f){this.realtime={continuity:a,memory:b," +
    "presentation:c.rpc,voiceHistory:d,multiAgentActivity:e," +
    "voice:f.rpc},this.disposables.add(c.dispose)}" +
    "control(e,t){switch(t.type){case`set-microphone-muted`:case" +
    "`set-output-muted`:return this.#i(e,t),!0}}};" +
    "let dependency={rpc:{},dispose(){}};" +
    "let coordinator=new Coordinator({},{},dependency,{},{}," +
    "{rpc:{}});" +
    "let session={pendingMicrophoneMuteIntents:[]," +
    "pendingOutputMuteIntents:[],snapshot:{microphoneMuted:true," +
    "outputMuted:false}};" +
    "globalThis.fixture={coordinator,session};";
  const result = patchMainSource(source, mainBundle());
  assert.equal(result.ok, true, result.reason);

  const context = vm.createContext({});
  new vm.Script(result.source).runInContext(context);
  const { coordinator, session } = context.fixture;

  coordinator.control(session, {
    type: "set-microphone-muted",
    muted: true,
  });
  const pendingMicrophoneIntent =
    session.pendingMicrophoneMuteIntents[0];
  coordinator.control(session, {
    type: "set-microphone-muted",
    muted: true,
  });
  coordinator.control(session, {
    type: "set-output-muted",
    muted: false,
  });
  coordinator.control(session, {
    type: "set-output-muted",
    muted: true,
  });

  assert.deepEqual(
    Array.from(coordinator.sent, ({ intent, queueLength }) => ({
      intent: { ...intent },
      queueLength,
    })),
    [
      {
        intent: {
          type: "set-microphone-muted",
          muted: true,
        },
        queueLength: 1,
      },
      {
        intent: {
          type: "set-microphone-muted",
          muted: true,
        },
        queueLength: 1,
      },
      {
        intent: {
          type: "set-output-muted",
          muted: true,
        },
        queueLength: 1,
      },
    ],
  );
  assert.equal(session.pendingMicrophoneMuteIntents.length, 1);
  assert.equal(
    session.pendingMicrophoneMuteIntents[0],
    pendingMicrophoneIntent,
  );
});
