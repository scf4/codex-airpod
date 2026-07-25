"use strict";

const path = require("node:path");

const CAPTURE_SYMBOL_KEY =
  "airpods-codex-mute.voice-coordinator.v1";
const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
const VOICE_COORDINATOR_ANCHOR = new RegExp(
  String.raw`this\.realtime=\{continuity:${IDENTIFIER},memory:${IDENTIFIER},presentation:(${IDENTIFIER})\.rpc,voiceHistory:${IDENTIFIER},multiAgentActivity:${IDENTIFIER},voice:${IDENTIFIER}\.rpc\},this\.disposables\.add\(\1\.dispose\)`,
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

  const matches = [
    ...source.matchAll(new RegExp(VOICE_COORDINATOR_ANCHOR)),
  ];
  if (matches.length !== 1) {
    return { ok: false, reason: "coordinator-shape-mismatch", source };
  }

  const match = matches[0];
  const boundary = "},this.disposables.add";
  const patchedAnchor = match[0].replace(
    boundary,
    `},${CAPTURE_EXPRESSION},this.disposables.add`,
  );
  if (patchedAnchor === match[0]) {
    return { ok: false, reason: "patch-boundary-missing", source };
  }

  const patched =
    source.slice(0, match.index) +
    patchedAnchor +
    source.slice(match.index + match[0].length);
  const remainingMatches = [
    ...patched.matchAll(new RegExp(VOICE_COORDINATOR_ANCHOR)),
  ];
  if (
    remainingMatches.length !== 0 ||
    occurrences(patched, CAPTURE_EXPRESSION) !== 1
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
