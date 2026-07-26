"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const {
  installRendererAssetTransform,
  isRendererBundle,
  patchRendererSource,
} = require("../src/renderer.cjs");

const TARGET_URL = "app://-/assets/app-initial-fixture.js";

function rendererSource({
  activityAtom = "CX",
  bridge = "gp",
  cache = "#n",
  claim = "#t",
  command = "n",
  conversation = "t",
  error = "e",
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
    `const ${main}={microphoneMuted:!1},` +
    `${local}={isMicrophoneMuted:!0};` +
    `const footer=${main}?.microphoneMuted??` +
    `${local}.isMicrophoneMuted;void footer;` +
    `globalThis.fixture={` +
    `control(e){owner.handleRealtimeVoiceHostControl(` +
    `stateStore,\`conversation\`,e)},` +
    `getInputCalls(){return[...owner.runtime.inputCalls]},` +
    `getMuted(){return stateStore.get(${microphoneAtom})},` +
    `microphone(e){owner.applyRealtimeMicrophoneMuteState(` +
    `stateStore,e)},` +
    `orb(){owner.toggleMicrophoneMute(stateStore,\`conversation\`)},` +
    `publish(e,t){claimInstance.publish(e,t)},` +
    `publishOwner(){owner.publishRealtimeVoiceHostState(stateStore)},` +
    `setBridge(e){${bridge}=e}};` +
    `/* export{${microphoneAtom} as IC} */`
  );
}

function evaluate(source) {
  const context = vm.createContext({});
  new vm.Script(source).runInContext(context);
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

test("renderer matcher accepts identifier and asset hash churn", () => {
  for (const [source, filename] of [
    [rendererSource(), TARGET_URL],
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
  const candidates = [
    ["not JavaScript", TARGET_URL],
    [source + source, TARGET_URL],
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
  harness.protocol.handle("app", async () => {
    stockResponse = new Response("unrecognized stock bytes", {
      headers: { "content-length": "24", "x-stock": "yes" },
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

  await appHandler({ url: TARGET_URL });
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
  let failedStock;
  harness.protocol.handle("app", async () => {
    requestCount += 1;
    const source = requestCount === 1
      ? rendererSource()
      : "new incompatible source";
    failedStock = new Response(source);
    return failedStock;
  });
  const appHandler = harness.handlers.get("app");

  const transformed = await appHandler({ url: TARGET_URL });
  assert.match(await transformed.text(), /__airpodsForce/);
  assert.equal(await installed.ready, true);
  assert.deepEqual(failures, []);

  const fallback = await appHandler({ url: TARGET_URL });
  assert.equal(fallback, failedStock);
  assert.equal(await fallback.text(), "new incompatible source");
  assert.deepEqual(failures, ["renderer-shape-mismatch"]);
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
