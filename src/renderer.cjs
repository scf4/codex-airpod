"use strict";

const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
const PRIVATE_IDENTIFIER = String.raw`#[A-Za-z_$][A-Za-z0-9_$]*`;
const FORCE_PARAMETER = "__airpodsForce";
const BRIDGE_VARIABLE = "__airpodsBridge";

const PUBLISHER_PATTERN = new RegExp(
  String.raw`publish\((?<payload>${IDENTIFIER})\)\{try\{var (?<scope>${IDENTIFIER})=(?<guard>${IDENTIFIER})\(\);if\(this\.(?<claim>${PRIVATE_IDENTIFIER})==null\)return;let (?<previous>${IDENTIFIER})=this\.(?<cache>${PRIVATE_IDENTIFIER});if\(\k<previous>!=null&&\k<previous>\.activity===\k<payload>\.activity&&\k<previous>\.microphoneMuted===\k<payload>\.microphoneMuted&&\k<previous>\.outputMuted===\k<payload>\.outputMuted&&\k<previous>\.phase===\k<payload>\.phase\)return;this\.\k<cache>=\k<payload>,\k<scope>\.u\((?<bridge>${IDENTIFIER})\?\.realtimeVoice\?\.publish\(this\.\k<claim>,\k<payload>\)\)\}catch\((?<error>${IDENTIFIER})\)\{\k<scope>\.e=\k<error>\}finally\{\k<scope>\.d\(\)\}\}`,
);

const MICROPHONE_COMMIT_PATTERN = new RegExp(
  String.raw`applyRealtimeMicrophoneMuteState\((?<store>${IDENTIFIER}),(?<muted>${IDENTIFIER})\)\{this\.runtime\?\.setInputMuted\(\k<muted>\),\k<store>\.set\((?<microphoneAtom>${IDENTIFIER}),\k<muted>\),this\.publishRealtimeVoiceHostState\(\k<store>\)\}`,
);

const HOST_PUBLICATION_PATTERN = new RegExp(
  String.raw`publishRealtimeVoiceHostState\((?<store>${IDENTIFIER})\)\{let (?<phase>${IDENTIFIER})=\k<store>\.get\((?<phaseAtom>${IDENTIFIER})\);\k<phase>!==\x60inactive\x60&&\(this\.realtimeVoiceHostClaim\.publish\(\{activity:\k<store>\.get\((?<activityAtom>${IDENTIFIER})\),microphoneMuted:\k<store>\.get\((?<microphoneAtom>${IDENTIFIER})\),outputMuted:\k<store>\.get\((?<outputAtom>${IDENTIFIER})\),phase:\k<phase>\}\),this\.updateRealtimeVoiceOrbAudioStream\(\)\)\}`,
);

const EXACT_CONTROL_PATTERN = new RegExp(
  String.raw`case\x60set-microphone-muted\x60:(?<store>${IDENTIFIER})\.get\((?<microphoneAtom>${IDENTIFIER})\)!==(?<command>${IDENTIFIER})\.muted&&this\.applyRealtimeMicrophoneMuteState\(\k<store>,\k<command>\.muted\);break;`,
);

const ORB_TOGGLE_PATTERN = new RegExp(
  String.raw`toggleMicrophoneMute\((?<store>${IDENTIFIER}),(?<conversation>${IDENTIFIER})\)\{if\(this\.conversationId!==\k<conversation>\|\|\k<store>\.get\((?<phaseAtom>${IDENTIFIER})\)!==\x60starting\x60&&\k<store>\.get\(\k<phaseAtom>\)!==\x60active\x60\|\|this\.runtime==null\)return;let (?<next>${IDENTIFIER})=!\k<store>\.get\((?<microphoneAtom>${IDENTIFIER})\);this\.applyRealtimeMicrophoneMuteState\(\k<store>,\k<next>\)\}`,
);

const FOOTER_MIRROR_PATTERN = new RegExp(
  String.raw`${IDENTIFIER}\?\.microphoneMuted\?\?${IDENTIFIER}\.isMicrophoneMuted`,
);

function matches(source, pattern) {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : pattern.flags + "g";
  return [
    ...source.matchAll(new RegExp(pattern.source, flags)),
  ];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function occurrences(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function isRendererBundle(filenameOrUrl) {
  if (typeof filenameOrUrl !== "string") return false;
  const normalized = filenameOrUrl.replaceAll("\\", "/");
  return (
    /^app:\/\/-\/assets\/app-initial-[^/?#]+\.js(?:[?#].*)?$/.test(
      normalized,
    ) ||
    /\/webview\/assets\/app-initial-[^/]+\.js$/.test(normalized)
  );
}

function replaceAllAt(source, replacements) {
  let patched = source;
  for (const replacement of replacements.sort(
    (left, right) => right.index - left.index,
  )) {
    patched =
      patched.slice(0, replacement.index) +
      replacement.value +
      patched.slice(replacement.index + replacement.length);
  }
  return patched;
}

function fail(source, reason) {
  return { ok: false, reason, source };
}

function patchRendererSource(source, filenameOrUrl) {
  if (typeof source !== "string" || !isRendererBundle(filenameOrUrl)) {
    return fail(source, "not-renderer-bundle");
  }
  if (
    source.includes(FORCE_PARAMETER) ||
    source.includes(BRIDGE_VARIABLE)
  ) {
    return fail(source, "already-patched");
  }

  const publisherMatches = matches(source, PUBLISHER_PATTERN);
  const commitMatches = matches(source, MICROPHONE_COMMIT_PATTERN);
  const publicationMatches = matches(source, HOST_PUBLICATION_PATTERN);
  const controlMatches = matches(source, EXACT_CONTROL_PATTERN);
  const orbMatches = matches(source, ORB_TOGGLE_PATTERN);
  const footerMatches = matches(source, FOOTER_MIRROR_PATTERN);
  if (
    publisherMatches.length !== 1 ||
    commitMatches.length !== 1 ||
    publicationMatches.length !== 1 ||
    controlMatches.length !== 1 ||
    orbMatches.length !== 1 ||
    footerMatches.length !== 1
  ) {
    return fail(source, "renderer-shape-mismatch");
  }

  const publisher = publisherMatches[0];
  const commit = commitMatches[0];
  const publication = publicationMatches[0];
  const control = controlMatches[0];
  const orb = orbMatches[0];
  const microphoneAtom = commit.groups.microphoneAtom;
  if (
    publication.groups.microphoneAtom !== microphoneAtom ||
    control.groups.microphoneAtom !== microphoneAtom ||
    orb.groups.microphoneAtom !== microphoneAtom ||
    orb.groups.phaseAtom !== publication.groups.phaseAtom
  ) {
    return fail(source, "mute-owner-mismatch");
  }

  const exportPattern = new RegExp(
    String.raw`(?:\{|,)${escapeRegExp(microphoneAtom)} as ${IDENTIFIER}(?:,|\})`,
    "g",
  );
  if (matches(source, exportPattern).length !== 1) {
    return fail(source, "orb-export-mismatch");
  }

  const publisherGroups = publisher.groups;
  const publisherReplacement =
    `publish(${publisherGroups.payload},${FORCE_PARAMETER}=!1){` +
    `try{var ${publisherGroups.scope}=${publisherGroups.guard}();` +
    `if(this.${publisherGroups.claim}==null)return;` +
    `let ${publisherGroups.previous}=this.${publisherGroups.cache},` +
    `${BRIDGE_VARIABLE}=${publisherGroups.bridge}?.realtimeVoice;` +
    `if(${BRIDGE_VARIABLE}==null)return;` +
    `if(!${FORCE_PARAMETER}&&${publisherGroups.previous}!=null&&` +
    `${publisherGroups.previous}.activity===${publisherGroups.payload}.activity&&` +
    `${publisherGroups.previous}.microphoneMuted===${publisherGroups.payload}.microphoneMuted&&` +
    `${publisherGroups.previous}.outputMuted===${publisherGroups.payload}.outputMuted&&` +
    `${publisherGroups.previous}.phase===${publisherGroups.payload}.phase)return;` +
    `${publisherGroups.scope}.u(${BRIDGE_VARIABLE}.publish(` +
    `this.${publisherGroups.claim},${publisherGroups.payload})),` +
    `this.${publisherGroups.cache}=${publisherGroups.payload}` +
    `}catch(${publisherGroups.error}){` +
    `${publisherGroups.scope}.e=${publisherGroups.error}}finally{` +
    `${publisherGroups.scope}.d()}}`;

  const commitGroups = commit.groups;
  const commitReplacement =
    `applyRealtimeMicrophoneMuteState(${commitGroups.store},` +
    `${commitGroups.muted}){this.runtime?.setInputMuted(` +
    `${commitGroups.muted}),${commitGroups.store}.set(` +
    `${commitGroups.microphoneAtom},${commitGroups.muted}),` +
    `this.publishRealtimeVoiceHostState(${commitGroups.store},!0)}`;

  const publicationGroups = publication.groups;
  const publicationReplacement =
    `publishRealtimeVoiceHostState(${publicationGroups.store},` +
    `${FORCE_PARAMETER}=!1){let ${publicationGroups.phase}=` +
    `${publicationGroups.store}.get(${publicationGroups.phaseAtom});` +
    `${publicationGroups.phase}!==\`inactive\`&&(` +
    `this.realtimeVoiceHostClaim.publish({activity:` +
    `${publicationGroups.store}.get(${publicationGroups.activityAtom}),` +
    `microphoneMuted:${publicationGroups.store}.get(` +
    `${publicationGroups.microphoneAtom}),outputMuted:` +
    `${publicationGroups.store}.get(${publicationGroups.outputAtom}),` +
    `phase:${publicationGroups.phase}},${FORCE_PARAMETER}),` +
    `this.updateRealtimeVoiceOrbAudioStream())}`;

  const controlGroups = control.groups;
  const controlReplacement =
    "case`set-microphone-muted`:" +
    `this.applyRealtimeMicrophoneMuteState(${controlGroups.store},` +
    `${controlGroups.command}.muted);break;`;

  const patched = replaceAllAt(source, [
    {
      index: publisher.index,
      length: publisher[0].length,
      value: publisherReplacement,
    },
    {
      index: commit.index,
      length: commit[0].length,
      value: commitReplacement,
    },
    {
      index: publication.index,
      length: publication[0].length,
      value: publicationReplacement,
    },
    {
      index: control.index,
      length: control[0].length,
      value: controlReplacement,
    },
  ]);

  const forcedCommit =
    `this.publishRealtimeVoiceHostState(${commitGroups.store},!0)`;
  const unconditionalControl =
    "case`set-microphone-muted`:" +
    `this.applyRealtimeMicrophoneMuteState(${controlGroups.store},` +
    `${controlGroups.command}.muted);break;`;
  if (
    matches(patched, PUBLISHER_PATTERN).length !== 0 ||
    matches(patched, MICROPHONE_COMMIT_PATTERN).length !== 0 ||
    matches(patched, HOST_PUBLICATION_PATTERN).length !== 0 ||
    matches(patched, EXACT_CONTROL_PATTERN).length !== 0 ||
    occurrences(patched, forcedCommit) !== 1 ||
    occurrences(patched, unconditionalControl) !== 1 ||
    occurrences(patched, `${FORCE_PARAMETER}=!1`) !== 2 ||
    occurrences(patched, `${BRIDGE_VARIABLE}.publish(`) !== 1
  ) {
    return fail(source, "renderer-patch-failed");
  }

  return { ok: true, source: patched };
}

function isTargetRequest(request) {
  return Boolean(
    request &&
      typeof request.url === "string" &&
      /^app:\/\/-\/assets\/app-initial-[^/?#]+\.js(?:[?#].*)?$/.test(
        request.url,
      ),
  );
}

function responseInit(response, { patched = false } = {}) {
  const headers = new Headers(response.headers);
  if (patched) headers.delete("content-length");
  return {
    headers,
    status: response.status,
    statusText: response.statusText,
  };
}

function installRendererAssetTransform(
  electron,
  { onFailure } = {},
) {
  const protocol = electron?.protocol;
  if (typeof protocol?.handle !== "function") {
    throw new TypeError("Electron protocol.handle is unavailable");
  }

  const originalHandle = protocol.handle;
  let disposed = false;
  let failureReported = false;
  let readySettled = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function settleReady(value) {
    if (readySettled) return;
    readySettled = true;
    resolveReady(value);
  }

  function reportFailure(reason) {
    settleReady(false);
    if (failureReported) return;
    failureReported = true;
    try {
      onFailure?.(reason);
    } catch {
      // Failure reporting cannot affect the stock renderer response.
    }
  }

  function restoreHandle() {
    if (protocol.handle === handleWithTransform) {
      protocol.handle = originalHandle;
    }
  }

  function handleWithTransform(scheme, stockHandler) {
    if (scheme !== "app" || typeof stockHandler !== "function") {
      return Reflect.apply(originalHandle, this, arguments);
    }

    restoreHandle();
    const transformedHandler = async (request) => {
      let stockResponse;
      try {
        stockResponse = await stockHandler(request);
      } catch (error) {
        if (!disposed && isTargetRequest(request)) {
          reportFailure("stock-handler-failed");
        }
        throw error;
      }
      if (disposed || !isTargetRequest(request)) return stockResponse;

      try {
        if (
          typeof stockResponse?.clone !== "function" ||
          typeof stockResponse?.text !== "function"
        ) {
          reportFailure("invalid-stock-response");
          return stockResponse;
        }
        const source = await stockResponse.clone().text();
        const result = patchRendererSource(source, request.url);
        if (!result.ok) {
          reportFailure(result.reason);
          return stockResponse;
        }

        const replacement = new Response(
          Buffer.from(result.source, "utf8"),
          responseInit(stockResponse, { patched: true }),
        );
        settleReady(true);
        return replacement;
      } catch {
        reportFailure("renderer-transform-failed");
        return stockResponse;
      }
    };

    const argumentsWithHandler = [...arguments];
    argumentsWithHandler[1] = transformedHandler;
    try {
      return Reflect.apply(
        originalHandle,
        this,
        argumentsWithHandler,
      );
    } catch (error) {
      reportFailure("app-protocol-registration-failed");
      throw error;
    }
  }

  try {
    protocol.handle = handleWithTransform;
  } catch (error) {
    reportFailure("protocol-hook-failed");
    throw error;
  }

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      restoreHandle();
      settleReady(false);
    },
  };
}

module.exports = {
  installRendererAssetTransform,
  isRendererBundle,
  patchRendererSource,
};
