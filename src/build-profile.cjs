"use strict";

const path = require("node:path");

const CAPTURE_SYMBOL_KEY =
  "airpods-codex-mute.voice-coordinator.v1";
const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
const PRIVATE_IDENTIFIER = String.raw`#[A-Za-z_$][A-Za-z0-9_$]*`;
const VOICE_COORDINATOR_ANCHOR = new RegExp(
  String.raw`this\.realtime=\{continuity:${IDENTIFIER},memory:${IDENTIFIER},presentation:(${IDENTIFIER})\.rpc,voiceHistory:${IDENTIFIER},multiAgentActivity:${IDENTIFIER},voice:${IDENTIFIER}\.rpc\},this\.disposables\.add\(\1\.dispose\)`,
  "g",
);
const MUTE_CONTROL_ANCHOR = new RegExp(
  String.raw`case\x60set-microphone-muted\x60:case\x60set-output-muted\x60:return this\.(?<method>${PRIVATE_IDENTIFIER})\(${IDENTIFIER},${IDENTIFIER}\),!0`,
  "g",
);
const MICROPHONE_DEDUPE_ANCHOR = new RegExp(
  String.raw`(?<method>${PRIVATE_IDENTIFIER})\((?<claim>${IDENTIFIER}),(?<command>${IDENTIFIER})\)\{let (?<queue>${IDENTIFIER})=\k<command>\.type===\x60set-microphone-muted\x60\?\k<claim>\.pendingMicrophoneMuteIntents:\k<claim>\.pendingOutputMuteIntents;if\(\(\k<queue>\.at\(-1\)\?\.muted\?\?\(\k<command>\.type===\x60set-microphone-muted\x60\?\k<claim>\.snapshot\.microphoneMuted:\k<claim>\.snapshot\.outputMuted\)\)===\k<command>\.muted\)return;let (?<intent>${IDENTIFIER})=\{\.\.\.\k<command>\};\k<queue>\.push\(\k<intent>\),this\.(?<dispatch>${PRIVATE_IDENTIFIER})\(\k<claim>,\k<queue>,\k<intent>\)\}`,
  "g",
);
const CAPTURE_EXPRESSION =
  `globalThis[Symbol.for("${CAPTURE_SYMBOL_KEY}")]?.(this.realtime.voice)`;

const PROFILE = Object.freeze({
  appPath: "/Applications/ChatGPT.app",
  appIdentifier: "com.openai.codex",
  appTeamIdentifier: "2DC432GLL2",
});

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

function isMainBundle(filename) {
  if (typeof filename !== "string") return false;
  return /\/app\.asar\/\.vite\/build\/main-[^/]+\.js$/.test(
    filename.replaceAll("\\", "/"),
  );
}

function patchMainSource(source, filename) {
  if (typeof source !== "string" || !isMainBundle(filename)) {
    return { ok: false, reason: "not-main-bundle", source };
  }
  if (occurrences(source, CAPTURE_EXPRESSION) !== 0) {
    return { ok: false, reason: "already-patched", source };
  }

  const coordinatorMatches = [
    ...source.matchAll(new RegExp(VOICE_COORDINATOR_ANCHOR)),
  ];
  if (coordinatorMatches.length !== 1) {
    return { ok: false, reason: "coordinator-shape-mismatch", source };
  }
  const controlMatches = [
    ...source.matchAll(new RegExp(MUTE_CONTROL_ANCHOR)),
  ];
  const dedupeMatches = [
    ...source.matchAll(new RegExp(MICROPHONE_DEDUPE_ANCHOR)),
  ];
  if (
    controlMatches.length !== 1 ||
    dedupeMatches.length !== 1 ||
    controlMatches[0].groups.method !== dedupeMatches[0].groups.method
  ) {
    return { ok: false, reason: "mute-control-shape-mismatch", source };
  }

  const coordinatorMatch = coordinatorMatches[0];
  const boundary = "},this.disposables.add";
  const patchedCoordinator = coordinatorMatch[0].replace(
    boundary,
    `},${CAPTURE_EXPRESSION},this.disposables.add`,
  );
  if (patchedCoordinator === coordinatorMatch[0]) {
    return { ok: false, reason: "patch-boundary-missing", source };
  }

  const dedupeMatch = dedupeMatches[0];
  const {
    method,
    claim,
    command,
    queue,
    intent,
    dispatch,
  } = dedupeMatch.groups;
  const patchedDedupe =
    `${method}(${claim},${command}){let ${queue}=` +
    `${command}.type===\`set-microphone-muted\`?` +
    `${claim}.pendingMicrophoneMuteIntents:` +
    `${claim}.pendingOutputMuteIntents;if(${queue}.at(-1)?.muted===` +
    `${command}.muted){if(${command}.type===` +
    `\`set-output-muted\`)return;this.${dispatch}(${claim},${queue},` +
    `${queue}.at(-1));return}if(${queue}.length===0&&` +
    `${command}.type===\`set-output-muted\`&&` +
    `${claim}.snapshot.outputMuted===${command}.muted)return;` +
    `let ${intent}={...${command}};${queue}.push(${intent}),` +
    `this.${dispatch}(${claim},${queue},${intent})}`;

  let patched = source;
  for (const replacement of [
    {
      index: coordinatorMatch.index,
      length: coordinatorMatch[0].length,
      value: patchedCoordinator,
    },
    {
      index: dedupeMatch.index,
      length: dedupeMatch[0].length,
      value: patchedDedupe,
    },
  ].sort((left, right) => right.index - left.index)) {
    patched =
      patched.slice(0, replacement.index) +
      replacement.value +
      patched.slice(replacement.index + replacement.length);
  }

  const remainingMatches = [
    ...patched.matchAll(new RegExp(VOICE_COORDINATOR_ANCHOR)),
  ];
  if (
    remainingMatches.length !== 0 ||
    [
      ...patched.matchAll(new RegExp(MICROPHONE_DEDUPE_ANCHOR)),
    ].length !== 0 ||
    occurrences(patched, CAPTURE_EXPRESSION) !== 1 ||
    occurrences(patched, patchedDedupe) !== 1
  ) {
    return { ok: false, reason: "patch-failed", source };
  }

  return { ok: true, source: patched };
}

function appPaths(profile = PROFILE) {
  return {
    executable: path.join(
      profile.appPath,
      "Contents",
      "MacOS",
      "ChatGPT",
    ),
  };
}

module.exports = {
  CAPTURE_SYMBOL_KEY,
  PROFILE,
  appPaths,
  isMainBundle,
  patchMainSource,
};
