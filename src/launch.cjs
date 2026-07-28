"use strict";

const { execFile, spawn } = require("node:child_process");
const { lstat } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";
const PROFILE = Object.freeze({
  appPath: "/Applications/ChatGPT.app",
  appIdentifier: "com.openai.codex",
  appTeamIdentifier: "2DC432GLL2",
});
const RUNTIME_FILES = [
  "airpods.cjs",
  "launch.cjs",
  "preload.cjs",
  "transforms.cjs",
];

function featureList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function hasFeature(args, switchName, feature) {
  const prefix = `--${switchName}=`;
  return args.some((argument) =>
    typeof argument === "string" &&
    argument.startsWith(prefix) &&
    featureList(argument.slice(prefix.length)).includes(feature),
  );
}

function withDisabledFeature(args, feature) {
  let merged = false;
  const result = args.map((argument) => {
    if (typeof argument !== "string" ||
        !argument.startsWith("--disable-features=")) {
      return argument;
    }
    merged = true;
    const features = featureList(
      argument.slice("--disable-features=".length),
    );
    if (!features.includes(feature)) features.push(feature);
    return `--disable-features=${features.join(",")}`;
  });
  if (!merged) result.push(`--disable-features=${feature}`);
  return result;
}

function parseArguments(argumentsList) {
  const checkOnly = argumentsList.includes("--check");
  const forwarded = argumentsList.filter((argument) => argument !== "--check");
  if (hasFeature(forwarded, "enable-features", AUDIO_SERVICE_FEATURE)) {
    throw new Error(`Cannot enable ${AUDIO_SERVICE_FEATURE} in AirPods mute mode`);
  }
  return {
    checkOnly,
    appArguments: withDisabledFeature(forwarded, AUDIO_SERVICE_FEATURE),
  };
}

function createEnvironment(base, { preloadPath }) {
  const environment = { ...base };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.NODE_OPTIONS = `--require=${JSON.stringify(preloadPath)}`;
  return environment;
}

async function assertSafeRuntimeFile(filePath) {
  const info = await lstat(filePath);
  const uid = process.getuid?.();
  const wrongOwner = uid !== undefined && info.uid !== uid;
  if (!info.isFile() || wrongOwner || (info.mode & 0o022) !== 0) {
    throw new Error(`Unsafe runtime file: ${filePath}`);
  }
}

async function verifyRuntimeFiles(sourceDirectory) {
  await Promise.all(
    RUNTIME_FILES.map((name) =>
      assertSafeRuntimeFile(path.join(sourceDirectory, name))),
  );
}

async function verifyExecutable(executable) {
  const info = await lstat(executable);
  if (!info.isFile() || (info.mode & 0o111) === 0) {
    throw new Error(`ChatGPT executable not found: ${executable}`);
  }
}

async function verifySignature() {
  await execFileAsync("/usr/bin/codesign", [
    "--verify", "--deep", "--strict", "--verbose=2", PROFILE.appPath,
  ]);
  const { stderr } = await execFileAsync(
    "/usr/bin/codesign",
    ["-d", "--verbose=4", PROFILE.appPath],
  );
  const correctIdentity =
    stderr.includes(`Identifier=${PROFILE.appIdentifier}`) &&
    stderr.includes(`TeamIdentifier=${PROFILE.appTeamIdentifier}`) &&
    stderr.includes("flags=0x10000(runtime)");
  if (!correctIdentity) {
    throw new Error("ChatGPT is not the expected signed OpenAI app");
  }
}

async function findRunningChatGPT() {
  const { stdout } = await execFileAsync("/bin/ps", [
    "-axo", "pid=,command=",
  ]);
  const pattern =
    /^\/Applications\/ChatGPT(?:-[^/]+)?\.app\/Contents\/MacOS\/ChatGPT(?:\s|$)/;
  return stdout
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter((match) => match && pattern.test(match[2]))
    .map((match) => ({ pid: Number(match[1]), command: match[2] }));
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function main(argumentsList = process.argv.slice(2)) {
  if (process.platform !== "darwin") {
    throw new Error("This launcher supports macOS only");
  }
  if (Number(process.versions.node.split(".")[0]) < 20) {
    throw new Error("Node.js 20 or newer is required");
  }

  const { appArguments, checkOnly } = parseArguments(argumentsList);
  const sourceDirectory = __dirname;
  const preloadPath = path.join(sourceDirectory, "preload.cjs");
  const executable = path.join(PROFILE.appPath, "Contents/MacOS/ChatGPT");

  await verifyRuntimeFiles(sourceDirectory);
  await verifyExecutable(executable);
  await verifySignature();

  const running = await findRunningChatGPT();
  if (running.length > 0) {
    const pids = running.map(({ pid }) => pid).join(", ");
    const error = new Error(
      `ChatGPT is already running (PID ${pids}). Quit it completely first.`);
    error.exitCode = 2;
    throw error;
  }
  if (checkOnly) {
    process.stdout.write("Ready for signed stock ChatGPT.\n");
    return;
  }

  const child = spawn(executable, appArguments, {
    detached: true,
    env: createEnvironment(process.env, { preloadPath }),
    stdio: "ignore",
  });
  await waitForSpawn(child);
  child.unref();
  process.stdout.write(
    "Launched signed stock ChatGPT with AirPods Codex mute control.\n" +
      "Launch ChatGPT normally next time to revert.\n",
  );
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  });
}

module.exports = { createEnvironment, parseArguments, withDisabledFeature };
