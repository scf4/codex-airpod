"use strict";

const CAPTURE_SYMBOL_KEY = "airpods-codex-mute.voice-coordinator.v1";
const CONTROL_COMMIT_SYMBOL_KEY =
  "airpods-codex-mute.control-with-commit.v1";
const COMMIT_STATE_SYMBOL_KEY =
  "airpods-codex-mute.commit-state.v1";
const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
const PRIVATE_IDENTIFIER = String.raw`#[A-Za-z_$][A-Za-z0-9_$]*`;
const FORCE_PARAMETER = "__airpodsForce";
const BRIDGE_VARIABLE = "__airpodsBridge";
const ACKNOWLEDGE_PARAMETER = "__airpodsAcknowledge";
const COMMIT_OPERATION = `Symbol.for("${CONTROL_COMMIT_SYMBOL_KEY}")`;
const COMMIT_STATE = `Symbol.for("${COMMIT_STATE_SYMBOL_KEY}")`;
const CAPTURE_EXPRESSION =
  `globalThis[Symbol.for("${CAPTURE_SYMBOL_KEY}")]?.(` +
  `typeof this.realtime.voice?.[${COMMIT_OPERATION}]===\`function\`?` +
  `this.realtime.voice:null)`;

const VOICE_COORDINATOR_PATTERN = new RegExp(
  String.raw`this\.realtime=\{continuity:${IDENTIFIER},memory:${IDENTIFIER},presentation:(${IDENTIFIER})\.rpc,voiceHistory:${IDENTIFIER},multiAgentActivity:${IDENTIFIER},voice:${IDENTIFIER}\.rpc\},this\.disposables\.add\(\1\.dispose\)`,
);
const MAIN_CONTROL_GUARD_PATTERN = new RegExp(
  String.raw`control\((?<locator>${IDENTIFIER}),(?<command>${IDENTIFIER})\)\{let (?<claim>${IDENTIFIER})=this\.(?<owner>${PRIVATE_IDENTIFIER});if\(\k<claim>==null\|\|\k<claim>\.cleanup!==\x60none\x60\|\|\k<claim>\.snapshot\.phase===\x60stopping\x60\|\|!(?<sameLocator>${IDENTIFIER})\(\k<claim>\.snapshot\.locator,\k<locator>\)\)return!1;`,
);
const MUTE_CONTROL_PATTERN = new RegExp(
  String.raw`case\x60set-microphone-muted\x60:case\x60set-output-muted\x60:return this\.(?<method>${PRIVATE_IDENTIFIER})\((?<claim>${IDENTIFIER}),(?<command>${IDENTIFIER})\),!0\}\}controlActive`,
);
const MAIN_DEDUPE_PATTERN = new RegExp(
  String.raw`(?<method>${PRIVATE_IDENTIFIER})\((?<claim>${IDENTIFIER}),(?<command>${IDENTIFIER})\)\{let (?<queue>${IDENTIFIER})=\k<command>\.type===\x60set-microphone-muted\x60\?\k<claim>\.pendingMicrophoneMuteIntents:\k<claim>\.pendingOutputMuteIntents;if\(\(\k<queue>\.at\(-1\)\?\.muted\?\?\(\k<command>\.type===\x60set-microphone-muted\x60\?\k<claim>\.snapshot\.microphoneMuted:\k<claim>\.snapshot\.outputMuted\)\)===\k<command>\.muted\)return;let (?<intent>${IDENTIFIER})=\{\.\.\.\k<command>\};\k<queue>\.push\(\k<intent>\),this\.(?<dispatch>${PRIVATE_IDENTIFIER})\(\k<claim>,\k<queue>,\k<intent>\)\}`,
);
const MAIN_DISPATCH_PATTERN = new RegExp(
  String.raw`async(?<method>${PRIVATE_IDENTIFIER})\((?<claim>${IDENTIFIER}),(?<queue>${IDENTIFIER}),(?<intent>${IDENTIFIER})\)\{try\{await \k<claim>\.controller\.control\(\k<intent>\)\}catch\((?<error>${IDENTIFIER})\)\{`,
);
const MAIN_DISPATCH_OWNER_PATTERN = new RegExp(
  String.raw`async(?<method>${PRIVATE_IDENTIFIER})\((?<claim>${IDENTIFIER}),(?<queue>${IDENTIFIER}),(?<intent>${IDENTIFIER})\)\{try\{await \k<claim>\.controller\.control\(\k<intent>\)\}catch\((?<error>${IDENTIFIER})\)\{[\s\S]{0,500}?this\.(?<owner>${PRIVATE_IDENTIFIER})!==\k<claim>\|\|\k<claim>\.cleanup!==\x60none\x60\)return;`,
);
const MAIN_PUBLICATION_PATTERN = new RegExp(
  String.raw`publish\((?<claimId>${IDENTIFIER}),(?<payload>${IDENTIFIER})\)\{let (?<claim>${IDENTIFIER})=this\.(?<owner>${PRIVATE_IDENTIFIER});\k<claim>\?\.claimId!==\k<claimId>\|\|\k<claim>\.cleanup!==\x60none\x60\|\|\(\k<claim>\.snapshot=\{\.\.\.\k<payload>,locator:\k<claim>\.snapshot\.locator,preferredPresentationSurface:\k<claim>\.snapshot\.preferredPresentationSurface,sessionId:\k<claim>\.snapshot\.sessionId\},\k<claim>\.pendingMicrophoneMuteIntents\[0\]\?\.muted===\k<payload>\.microphoneMuted&&\k<claim>\.pendingMicrophoneMuteIntents\.shift\(\)`,
);

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
  String.raw`(?<projection>${IDENTIFIER})=(?<snapshot>${IDENTIFIER})\.phase!==\x60inactive\x60&&(?<conversation>${IDENTIFIER})!=null&&\k<snapshot>\.locator\.conversationId===\k<conversation>&&\k<snapshot>\.locator\.hostId===(?<host>${IDENTIFIER})\?\k<snapshot>:null,(?<phase>${IDENTIFIER})=(?<unavailable>${IDENTIFIER})\?\x60inactive\x60:\k<projection>\?\.phase\?\?(?<local>${IDENTIFIER})\.phase,(?<output>${IDENTIFIER})=\k<projection>\?\.outputMuted\?\?\k<local>\.isMuted,(?<microphone>${IDENTIFIER})=\k<projection>\?\.microphoneMuted\?\?\k<local>\.isMicrophoneMuted`,
);

const RENDERER_PATTERNS = {
  publisher: PUBLISHER_PATTERN,
  commit: MICROPHONE_COMMIT_PATTERN,
  publication: HOST_PUBLICATION_PATTERN,
  control: EXACT_CONTROL_PATTERN,
  orb: ORB_TOGGLE_PATTERN,
  footer: FOOTER_MIRROR_PATTERN,
};

function matches(source, pattern) {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))];
}

function uniqueMatches(source, patterns) {
  const found = {};
  for (const [name, pattern] of Object.entries(patterns)) {
    const candidates = matches(source, pattern);
    if (candidates.length !== 1) return null;
    found[name] = candidates[0];
  }
  return found;
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

function skipQuoted(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
    } else if (source[index] === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return index;
}

function skipRegularExpression(source, start) {
  let index = start + 1;
  let characterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
    } else if (character === "[") {
      characterClass = true;
      index += 1;
    } else if (character === "]") {
      characterClass = false;
      index += 1;
    } else if (character === "/" && !characterClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
      return index;
    } else if (character === "\n" || character === "\r") {
      return start + 1;
    } else {
      index += 1;
    }
  }
  return start + 1;
}

function regexCanFollow(previous) {
  if (previous == null) return true;
  if (previous.type === "identifier") {
    return [
      "await", "case", "delete", "do", "else", "in",
      "instanceof", "of", "return", "throw", "typeof",
      "void", "yield",
    ].includes(previous.value);
  }
  return previous.type === "punctuator" &&
    ![")", "]", "}", "++", "--"].includes(previous.value);
}

function isControlHeader(previous) {
  return previous?.controlHeader === true;
}

function isBlockOpening(previous) {
  return (
    previous == null ||
    (
      previous.type === "punctuator" &&
      [
        ")", "=>", ";", "block-close", "control-close",
        "label-colon",
      ].includes(previous.value)
    ) ||
    previous.startsBody === true
  );
}

function identifierToken(value, previous, statementStart) {
  const property =
    previous?.type === "punctuator" &&
    [".", "?."].includes(previous.value);
  const forAwait =
    value === "await" &&
    previous?.type === "identifier" &&
    previous.value === "for" &&
    previous.controlHeader === true;
  return {
    type: "identifier",
    value,
    property,
    controlHeader:
      !property &&
      (
        ["catch", "for", "if", "switch", "while", "with"]
          .includes(value) ||
        forAwait
      ),
    labelCandidate: statementStart && !property,
    startsBody:
      !property &&
      ["catch", "do", "else", "finally", "static", "try"]
        .includes(value),
  };
}

function numberAt(source, index) {
  return source.slice(index).match(
    /^(?:0[xX][\dA-Fa-f]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?n?/,
  )?.[0] ?? null;
}

function punctuatorAt(source, index) {
  return ["??=", "?.", "??", "++", "--", "=>"].find(
    (candidate) => source.startsWith(candidate, index),
  ) ?? source[index];
}

function sameCaseLevel(context, braces, parentheses, bracketDepth) {
  return Boolean(
    context &&
    context.braceDepth === braces.length &&
    context.parenthesisDepth === parentheses.length &&
    context.bracketDepth === bracketDepth,
  );
}

function hasLineBreak(source, start, end) {
  return /[\n\r\u2028\u2029]/.test(source.slice(start, end));
}

function canEndStatement(previous) {
  return Boolean(
    previous &&
    (
      previous.type === "identifier" ||
      previous.type === "literal" ||
      (
        previous.type === "punctuator" &&
        [
          ")", "]", "}", "++", "--", "block-close",
        ].includes(previous.value)
      )
    ),
  );
}

function skipTemplateExpression(source, start) {
  const blocks = [];
  const parentheses = [];
  let bracketDepth = 0;
  let caseContext = null;
  let depth = 1;
  let index = start;
  let previous = null;
  let statementStart = true;

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      if (
        /[\n\r\u2028\u2029]/.test(character) &&
        parentheses.length === 0 &&
        bracketDepth === 0 &&
        canEndStatement(previous)
      ) {
        statementStart = true;
      }
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const next = end === -1 ? source.length : end + 2;
      if (
        hasLineBreak(source, index, next) &&
        parentheses.length === 0 &&
        bracketDepth === 0 &&
        canEndStatement(previous)
      ) {
        statementStart = true;
      }
      index = next;
      continue;
    }
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character);
      previous = { type: "literal" };
      statementStart = false;
      continue;
    }
    if (character === "`") {
      index = skipTemplate(source, index);
      previous = { type: "literal" };
      statementStart = false;
      continue;
    }
    if (character === "/" && regexCanFollow(previous)) {
      index = skipRegularExpression(source, index);
      previous = { type: "literal" };
      statementStart = false;
      continue;
    }

    const identifier = source.slice(index).match(
      /^[A-Za-z_$][A-Za-z0-9_$]*/,
    )?.[0];
    if (identifier) {
      const token = identifierToken(
        identifier,
        previous,
        statementStart,
      );
      if (token.value === "case" && token.labelCandidate) {
        caseContext = {
          braceDepth: blocks.length,
          bracketDepth,
          parenthesisDepth: parentheses.length,
          ternaryDepth: 0,
        };
      }
      previous = token;
      statementStart = previous.startsBody;
      index += identifier.length;
      continue;
    }
    const number = numberAt(source, index);
    if (number) {
      previous = { type: "literal" };
      statementStart = false;
      index += number.length;
      continue;
    }

    let closesControlHeader = false;
    let closesBlock = false;
    let opensBlock = false;
    if (character === "(") {
      parentheses.push(isControlHeader(previous));
    } else if (character === ")") {
      closesControlHeader = parentheses.pop() === true;
    } else if (character === "{") {
      opensBlock = isBlockOpening(previous);
      depth += 1;
      blocks.push(opensBlock);
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
      closesBlock = blocks.pop() === true;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth -= 1;

    const lexicalPunctuator = punctuatorAt(source, index);
    const atCaseLevel = sameCaseLevel(
      caseContext,
      blocks,
      parentheses,
      bracketDepth,
    );
    if (lexicalPunctuator === "?" && atCaseLevel) {
      caseContext.ternaryDepth += 1;
    }
    let caseColon = false;
    if (lexicalPunctuator === ":" && atCaseLevel) {
      if (caseContext.ternaryDepth > 0) {
        caseContext.ternaryDepth -= 1;
      } else {
        caseColon = true;
        caseContext = null;
      }
    }
    const labelColon =
      lexicalPunctuator === ":" &&
      (previous?.labelCandidate === true || caseColon);
    let punctuator = lexicalPunctuator;
    if (closesControlHeader) {
      punctuator = "control-close";
    } else if (closesBlock) {
      punctuator = "block-close";
    } else if (labelColon) {
      punctuator = "label-colon";
    }
    previous = {
      type: "punctuator",
      value: punctuator,
    };
    statementStart =
      previous.value === "control-close" ||
      previous.value === "block-close" ||
      previous.value === "label-colon" ||
      (
        lexicalPunctuator === ";" &&
        parentheses.length === 0
      ) ||
      (character === "{" && opensBlock);
    index += lexicalPunctuator.length;
  }
  return index;
}

function skipTemplate(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
    } else if (source[index] === "`") {
      return index + 1;
    } else if (source.startsWith("${", index)) {
      index = skipTemplateExpression(source, index + 2);
    } else {
      index += 1;
    }
  }
  return index;
}

function structuralContexts(source, positions) {
  const sorted = [...positions].sort((left, right) => left - right);
  const results = new Map();
  const braces = [];
  const parentheses = [];
  let pendingClass = null;
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let caseContext = null;
  let previous = null;
  let statementStart = true;
  let point = 0;
  let index = 0;

  const recordPositions = () => {
    while (point < sorted.length && sorted[point] <= index) {
      const enclosingClass = [...braces]
        .reverse()
        .find((brace) => brace.classStart != null);
      results.set(sorted[point], {
        classStart: enclosingClass?.classStart ?? -1,
        code: true,
      });
      point += 1;
    }
  };
  const rejectNonCodePositions = (end) => {
    while (point < sorted.length && sorted[point] < end) {
      results.set(sorted[point], {
        classStart: -1,
        code: false,
      });
      point += 1;
    }
    index = end;
  };

  while (index < source.length && point < sorted.length) {
    recordPositions();
    const character = source[index];
    if (/\s/.test(character)) {
      if (
        /[\n\r\u2028\u2029]/.test(character) &&
        parentheses.length === 0 &&
        bracketDepth === 0 &&
        canEndStatement(previous)
      ) {
        statementStart = true;
      }
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      rejectNonCodePositions(end === -1 ? source.length : end);
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const next = end === -1 ? source.length : end + 2;
      if (
        hasLineBreak(source, index, next) &&
        parentheses.length === 0 &&
        bracketDepth === 0 &&
        canEndStatement(previous)
      ) {
        statementStart = true;
      }
      rejectNonCodePositions(next);
      continue;
    }
    if (character === "'" || character === '"') {
      rejectNonCodePositions(skipQuoted(source, index, character));
      previous = { type: "literal" };
      statementStart = false;
      continue;
    }
    if (character === "`") {
      rejectNonCodePositions(skipTemplate(source, index));
      previous = { type: "literal" };
      statementStart = false;
      continue;
    }
    if (character === "/" && regexCanFollow(previous)) {
      rejectNonCodePositions(skipRegularExpression(source, index));
      previous = { type: "literal" };
      statementStart = false;
      continue;
    }

    const identifier = source.slice(index).match(
      /^[A-Za-z_$][A-Za-z0-9_$]*/,
    );
    if (identifier) {
      const token = identifierToken(
        identifier[0],
        previous,
        statementStart,
      );
      if (token.value === "class" && !token.property) {
        pendingClass = {
          bracketDepth,
          classStart: index,
          parenthesisDepth,
          braceDepth: braces.length,
        };
      }
      if (token.value === "case" && token.labelCandidate) {
        caseContext = {
          braceDepth: braces.length,
          bracketDepth,
          parenthesisDepth: parentheses.length,
          ternaryDepth: 0,
        };
      }
      previous = token;
      statementStart = previous.startsBody;
      index += identifier[0].length;
      continue;
    }
    const number = numberAt(source, index);
    if (number) {
      previous = { type: "literal" };
      statementStart = false;
      index += number.length;
      continue;
    }

    let closesControlHeader = false;
    let closesBlock = false;
    let opensBlock = false;
    if (character === "(") {
      parentheses.push(isControlHeader(previous));
      parenthesisDepth += 1;
    }
    if (character === ")") {
      parenthesisDepth -= 1;
      closesControlHeader = parentheses.pop() === true;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth -= 1;
    if (character === "{") {
      const opensClass =
        pendingClass != null &&
        pendingClass.braceDepth === braces.length &&
        pendingClass.parenthesisDepth === parenthesisDepth &&
        pendingClass.bracketDepth === bracketDepth;
      opensBlock = opensClass || isBlockOpening(previous);
      braces.push({
        classStart: opensClass ? pendingClass.classStart : null,
        block: opensBlock,
      });
      if (opensClass) pendingClass = null;
    } else if (character === "}") {
      closesBlock = braces.pop()?.block === true;
    }
    const lexicalPunctuator = punctuatorAt(source, index);
    const atCaseLevel = sameCaseLevel(
      caseContext,
      braces,
      parentheses,
      bracketDepth,
    );
    if (lexicalPunctuator === "?" && atCaseLevel) {
      caseContext.ternaryDepth += 1;
    }
    let caseColon = false;
    if (lexicalPunctuator === ":" && atCaseLevel) {
      if (caseContext.ternaryDepth > 0) {
        caseContext.ternaryDepth -= 1;
      } else {
        caseColon = true;
        caseContext = null;
      }
    }
    const labelColon =
      lexicalPunctuator === ":" &&
      (previous?.labelCandidate === true || caseColon);
    let punctuator = lexicalPunctuator;
    if (closesControlHeader) {
      punctuator = "control-close";
    } else if (closesBlock) {
      punctuator = "block-close";
    } else if (labelColon) {
      punctuator = "label-colon";
    }
    previous = { type: "punctuator", value: punctuator };
    statementStart =
      punctuator === "control-close" ||
      punctuator === "block-close" ||
      punctuator === "label-colon" ||
      (
        lexicalPunctuator === ";" &&
        parentheses.length === 0
      ) ||
      (character === "{" && opensBlock);
    index += lexicalPunctuator.length;
  }
  recordPositions();
  return positions.map(
    (position) =>
      results.get(position) ?? { classStart: -1, code: false },
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMatches(source, replacements) {
  let patched = source;
  const descending = [...replacements].sort(
    ([left], [right]) => right.index - left.index,
  );
  for (const [match, replacement] of descending) {
    patched =
      patched.slice(0, match.index) +
      replacement +
      patched.slice(match.index + match[0].length);
  }
  return patched;
}

function fail(source, reason) {
  return { ok: false, reason, source };
}

function isMainBundle(filename) {
  if (typeof filename !== "string") return false;
  return /\/app\.asar\/\.vite\/build\/main-[^/]+\.js$/.test(
    filename.replaceAll("\\", "/"),
  );
}

function patchMainSource(source, filename) {
  if (typeof source !== "string" || !isMainBundle(filename)) {
    return fail(source, "not-main-bundle");
  }
  if (
    occurrences(source, CAPTURE_EXPRESSION) !== 0 ||
    source.includes(CONTROL_COMMIT_SYMBOL_KEY) ||
    source.includes(COMMIT_STATE_SYMBOL_KEY)
  ) {
    return fail(source, "already-patched");
  }

  const coordinatorMatches = matches(source, VOICE_COORDINATOR_PATTERN);
  if (coordinatorMatches.length !== 1) {
    return fail(source, "coordinator-shape-mismatch");
  }
  const guardMatches = matches(source, MAIN_CONTROL_GUARD_PATTERN);
  const controlMatches = matches(source, MUTE_CONTROL_PATTERN);
  const dedupeMatches = matches(source, MAIN_DEDUPE_PATTERN);
  const dispatchMatches = matches(source, MAIN_DISPATCH_PATTERN);
  const dispatchOwnerMatches = matches(
    source,
    MAIN_DISPATCH_OWNER_PATTERN,
  );
  const publicationMatches = matches(source, MAIN_PUBLICATION_PATTERN);
  const flowMatches = [
    publicationMatches[0],
    guardMatches[0],
    controlMatches[0],
    dedupeMatches[0],
    dispatchMatches[0],
  ];
  const contexts = structuralContexts(
    source,
    [coordinatorMatches[0], ...flowMatches]
      .filter(Boolean)
      .map((match) => match.index),
  );
  const coordinatorContext = contexts[0];
  const flowContexts = contexts.slice(1);
  const classStarts = new Set(
    flowContexts.map(({ classStart }) => classStart),
  );
  if (
    guardMatches.length !== 1 ||
    controlMatches.length !== 1 ||
    dedupeMatches.length !== 1 ||
    dispatchMatches.length !== 1 ||
    dispatchOwnerMatches.length !== 1 ||
    publicationMatches.length !== 1 ||
    coordinatorContext?.code !== true ||
    flowContexts.some(({ code }) => !code) ||
    classStarts.size !== 1 ||
    classStarts.has(-1) ||
    !(
      publicationMatches[0].index < guardMatches[0].index &&
      guardMatches[0].index < controlMatches[0].index &&
      controlMatches[0].index < dedupeMatches[0].index &&
      dedupeMatches[0].index < dispatchMatches[0].index
    ) ||
    guardMatches[0].groups.claim !== controlMatches[0].groups.claim ||
    guardMatches[0].groups.command !== controlMatches[0].groups.command ||
    guardMatches[0].groups.owner !== publicationMatches[0].groups.owner ||
    guardMatches[0].groups.owner !==
      dispatchOwnerMatches[0].groups.owner ||
    controlMatches[0].groups.method !== dedupeMatches[0].groups.method ||
    dedupeMatches[0].groups.dispatch !== dispatchMatches[0].groups.method ||
    dispatchMatches[0].index !== dispatchOwnerMatches[0].index
  ) {
    return fail(source, "mute-control-shape-mismatch");
  }
  const found = {
    coordinator: coordinatorMatches[0],
    guard: guardMatches[0],
    control: controlMatches[0],
    dedupe: dedupeMatches[0],
    dispatch: dispatchMatches[0],
    publication: publicationMatches[0],
  };

  const coordinatorReplacement = found.coordinator[0].replace(
    "},this.disposables.add",
    `},${CAPTURE_EXPRESSION},this.disposables.add`,
  );
  if (coordinatorReplacement === found.coordinator[0]) {
    return fail(source, "patch-boundary-missing");
  }

  const { owner, sameLocator } = found.guard.groups;
  const control = found.control.groups;
  const controlReplacement = [
    `case\`set-microphone-muted\`:case\`set-output-muted\`:`,
    `return this.${control.method}(${control.claim},${control.command}),!0}}`,
    `[${COMMIT_OPERATION}](__airpodsLocator,__airpodsCommand){`,
    `let __airpodsClaim=this.${owner};`,
    `if(__airpodsClaim==null||__airpodsClaim.cleanup!==\`none\`||`,
    `(__airpodsClaim.snapshot.phase!==\`starting\`&&`,
    `__airpodsClaim.snapshot.phase!==\`active\`)||`,
    `!${sameLocator}(__airpodsClaim.snapshot.locator,__airpodsLocator)||`,
    `__airpodsCommand?.type!==\`set-microphone-muted\`||`,
    `typeof __airpodsCommand.muted!==\`boolean\`)return{accepted:!1,`,
    `committed:Promise.resolve(!1)};`,
    `let __airpodsDispatch=this.${control.method}(`,
    `__airpodsClaim,__airpodsCommand,!0);`,
    `return{accepted:!0,committed:Promise.resolve(`,
    `__airpodsDispatch.rpc).then(__airpodsCommitted=>`,
    `__airpodsCommitted===!0?__airpodsDispatch.published.then(()=>`,
    `this.${owner}===__airpodsClaim&&`,
    `__airpodsClaim.cleanup===\`none\`&&`,
    `(__airpodsClaim.snapshot.phase===\`starting\`||`,
    `__airpodsClaim.snapshot.phase===\`active\`)&&`,
    `${sameLocator}(__airpodsClaim.snapshot.locator,__airpodsLocator)&&`,
    `__airpodsClaim.snapshot.microphoneMuted===`,
    `__airpodsCommand.muted):!1,()=>!1)}}controlActive`,
  ].join("");

  const {
    method, claim, command, queue, intent, dispatch,
  } = found.dedupe.groups;
  const dedupeReplacement = [
    `${method}(${claim},${command},${ACKNOWLEDGE_PARAMETER}=!1){`,
    `let ${queue}=`,
    `${command}.type===\`set-microphone-muted\`?`,
    `${claim}.pendingMicrophoneMuteIntents:`,
    `${claim}.pendingOutputMuteIntents,${intent}=${queue}.at(-1);`,
    `if(${intent}?.muted===${command}.muted){`,
    `if(${command}.type===\`set-output-muted\`)return}`,
    `else{if(${queue}.length===0&&${command}.type===`,
    `\`set-output-muted\`&&${claim}.snapshot.outputMuted===`,
    `${command}.muted)return;${intent}={...${command}},`,
    `${queue}.push(${intent})}`,
    `let __airpodsCommit=${intent}[${COMMIT_STATE}];`,
    `if(${command}.type===\`set-microphone-muted\`&&`,
    `__airpodsCommit==null){let __airpodsResolve;`,
    `__airpodsCommit={published:new Promise(`,
    `__airpodsDone=>{__airpodsResolve=__airpodsDone}),`,
    `resolve:()=>__airpodsResolve(!0),active:0,succeeded:!1},`,
    `Object.defineProperty(${intent},${COMMIT_STATE},`,
    `{value:__airpodsCommit})}`,
    `__airpodsCommit&&(__airpodsCommit.active+=1);`,
    `let __airpodsRpc=this.${dispatch}(${claim},${queue},${intent},`,
    `__airpodsCommit);`,
    `if(!${ACKNOWLEDGE_PARAMETER})return;`,
    `return{rpc:__airpodsRpc,`,
    `published:__airpodsCommit.published}}`,
  ].join("");

  const dispatchGroups = found.dispatch.groups;
  const dispatchReplacement = [
    `async${dispatchGroups.method}(${dispatchGroups.claim},`,
    `${dispatchGroups.queue},${dispatchGroups.intent},`,
    `__airpodsCommit){try{`,
    `await ${dispatchGroups.claim}.controller.control(`,
    `${dispatchGroups.intent});`,
    `return __airpodsCommit&&(__airpodsCommit.succeeded=!0,`,
    `__airpodsCommit.active-=1),!0}catch(${dispatchGroups.error}){`,
    `if(__airpodsCommit&&(--__airpodsCommit.active>0||`,
    `__airpodsCommit.succeeded))return;`,
  ].join("");

  const publication = found.publication.groups;
  const publicationReplacement = [
    `publish(${publication.claimId},${publication.payload}){`,
    `let ${publication.claim}=this.${publication.owner};`,
    `${publication.claim}?.claimId!==${publication.claimId}||`,
    `${publication.claim}.cleanup!==\`none\`||(`,
    `${publication.claim}.snapshot={...${publication.payload},`,
    `locator:${publication.claim}.snapshot.locator,`,
    `preferredPresentationSurface:`,
    `${publication.claim}.snapshot.preferredPresentationSurface,`,
    `sessionId:${publication.claim}.snapshot.sessionId},`,
    `(()=>{let __airpodsIntent=`,
    `${publication.claim}.pendingMicrophoneMuteIntents[0];`,
    `if(__airpodsIntent?.muted!==`,
    `${publication.payload}.microphoneMuted)return;`,
    `${publication.claim}.pendingMicrophoneMuteIntents.shift(),`,
    `__airpodsIntent[${COMMIT_STATE}]?.resolve()})()`,
  ].join("");

  const patched = replaceMatches(source, [
    [found.coordinator, coordinatorReplacement],
    [found.control, controlReplacement],
    [found.dedupe, dedupeReplacement],
    [found.dispatch, dispatchReplacement],
    [found.publication, publicationReplacement],
  ]);
  if (
    matches(patched, VOICE_COORDINATOR_PATTERN).length !== 0 ||
    matches(patched, MUTE_CONTROL_PATTERN).length !== 0 ||
    matches(patched, MAIN_DEDUPE_PATTERN).length !== 0 ||
    matches(patched, MAIN_DISPATCH_PATTERN).length !== 0 ||
    matches(patched, MAIN_DISPATCH_OWNER_PATTERN).length !== 0 ||
    matches(patched, MAIN_PUBLICATION_PATTERN).length !== 0 ||
    occurrences(patched, CAPTURE_EXPRESSION) !== 1 ||
    occurrences(patched, controlReplacement) !== 1 ||
    occurrences(patched, dedupeReplacement) !== 1 ||
    occurrences(patched, dispatchReplacement) !== 1 ||
    occurrences(patched, publicationReplacement) !== 1 ||
    occurrences(patched, CONTROL_COMMIT_SYMBOL_KEY) !== 2 ||
    occurrences(patched, COMMIT_STATE_SYMBOL_KEY) !== 3
  ) {
    return fail(source, "patch-failed");
  }
  return { ok: true, source: patched };
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

  const found = uniqueMatches(source, RENDERER_PATTERNS);
  if (found == null) return fail(source, "renderer-shape-mismatch");

  const microphoneAtom = found.commit.groups.microphoneAtom;
  if (
    found.publication.groups.microphoneAtom !== microphoneAtom ||
    found.control.groups.microphoneAtom !== microphoneAtom ||
    found.orb.groups.microphoneAtom !== microphoneAtom ||
    found.orb.groups.phaseAtom !== found.publication.groups.phaseAtom
  ) {
    return fail(source, "mute-owner-mismatch");
  }

  const exportPattern = new RegExp(
    String.raw`(?:\{|,)${escapeRegExp(microphoneAtom)} as ${IDENTIFIER}(?:,|\})`,
  );
  const exportMatches = matches(source, exportPattern);
  const exportMatch = exportMatches[0];
  const exportStart = exportMatch == null
    ? -1
    : source.lastIndexOf("export{", exportMatch.index);
  const exportEnd = exportStart === -1
    ? -1
    : source.indexOf("}", exportStart);
  if (
    exportMatches.length !== 1 ||
    exportStart === -1 ||
    exportEnd + 1 < exportMatch.index + exportMatch[0].length
  ) {
    return fail(source, "orb-export-mismatch");
  }

  const structuralMatches = [
    found.publisher,
    found.commit,
    found.publication,
    found.control,
    found.orb,
    found.footer,
  ];
  const contexts = structuralContexts(
    source,
    [
      ...structuralMatches.map((match) => match.index),
      exportStart,
      exportMatch.index,
    ],
  );
  const publisherContext = contexts[0];
  const ownerContexts = contexts.slice(1, 5);
  if (
    contexts.some(({ code }) => !code) ||
    publisherContext.classStart === -1 ||
    ownerContexts.some(({ classStart }) => classStart === -1) ||
    new Set(
      ownerContexts.map(({ classStart }) => classStart),
    ).size !== 1
  ) {
    return fail(source, "renderer-owner-shape-mismatch");
  }

  const publisher = found.publisher.groups;
  const publisherReplacement = [
    `publish(${publisher.payload},${FORCE_PARAMETER}=!1){`,
    `try{var ${publisher.scope}=${publisher.guard}();`,
    `if(this.${publisher.claim}==null)return;`,
    `let ${publisher.previous}=this.${publisher.cache},`,
    `${BRIDGE_VARIABLE}=${publisher.bridge}?.realtimeVoice;`,
    `if(${BRIDGE_VARIABLE}==null)return;`,
    `if(!${FORCE_PARAMETER}&&${publisher.previous}!=null&&`,
    `${publisher.previous}.activity===${publisher.payload}.activity&&`,
    `${publisher.previous}.microphoneMuted===${publisher.payload}.microphoneMuted&&`,
    `${publisher.previous}.outputMuted===${publisher.payload}.outputMuted&&`,
    `${publisher.previous}.phase===${publisher.payload}.phase)return;`,
    `${publisher.scope}.u(${BRIDGE_VARIABLE}.publish(`,
    `this.${publisher.claim},${publisher.payload})),`,
    `this.${publisher.cache}=${publisher.payload}`,
    `}catch(${publisher.error}){${publisher.scope}.e=${publisher.error}}`,
    `finally{${publisher.scope}.d()}}`,
  ].join("");

  const commit = found.commit.groups;
  const commitReplacement = [
    `applyRealtimeMicrophoneMuteState(${commit.store},${commit.muted}){`,
    `this.runtime.setInputMuted(${commit.muted}),`,
    `${commit.store}.set(${commit.microphoneAtom},${commit.muted}),`,
    `this.publishRealtimeVoiceHostState(${commit.store},!0)}`,
  ].join("");

  const publication = found.publication.groups;
  const publicationReplacement = [
    `publishRealtimeVoiceHostState(${publication.store},`,
    `${FORCE_PARAMETER}=!1){let ${publication.phase}=`,
    `${publication.store}.get(${publication.phaseAtom});`,
    `${publication.phase}!==\`inactive\`&&(`,
    `this.realtimeVoiceHostClaim.publish({activity:`,
    `${publication.store}.get(${publication.activityAtom}),`,
    `microphoneMuted:${publication.store}.get(${publication.microphoneAtom}),`,
    `outputMuted:${publication.store}.get(${publication.outputAtom}),`,
    `phase:${publication.phase}},${FORCE_PARAMETER}),`,
    `this.updateRealtimeVoiceOrbAudioStream())}`,
  ].join("");

  const control = found.control.groups;
  const controlReplacement = "case`set-microphone-muted`:" +
    `this.applyRealtimeMicrophoneMuteState(${control.store},` +
    `${control.command}.muted);break;`;

  const patched = replaceMatches(source, [
    [found.publisher, publisherReplacement],
    [found.commit, commitReplacement],
    [found.publication, publicationReplacement],
    [found.control, controlReplacement],
  ]);
  const forcedCommit =
    `this.publishRealtimeVoiceHostState(${commit.store},!0)`;
  const forcedPublicationPattern = new RegExp(
    String.raw`this\.publishRealtimeVoiceHostState\(${IDENTIFIER},!0\)`,
  );
  if (
    [
      PUBLISHER_PATTERN,
      MICROPHONE_COMMIT_PATTERN,
      HOST_PUBLICATION_PATTERN,
      EXACT_CONTROL_PATTERN,
    ].some((pattern) => matches(patched, pattern).length !== 0) ||
    occurrences(patched, forcedCommit) !== 1 ||
    matches(patched, forcedPublicationPattern).length !== 1 ||
    occurrences(patched, controlReplacement) !== 1 ||
    occurrences(patched, `${FORCE_PARAMETER}=!1`) !== 2 ||
    occurrences(patched, `${BRIDGE_VARIABLE}.publish(`) !== 1 ||
    occurrences(patched, publisherReplacement) !== 1
  ) {
    return fail(source, "renderer-patch-failed");
  }
  return { ok: true, source: patched };
}

module.exports = {
  CAPTURE_SYMBOL_KEY, CONTROL_COMMIT_SYMBOL_KEY,
  isMainBundle, patchMainSource,
  isRendererBundle, patchRendererSource,
};
