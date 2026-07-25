"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createEnvironment,
  parseArguments,
  withDisabledFeature,
} = require("../src/launch.cjs");

const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";

test("launcher adds the in-process audio feature kill switch", () => {
  assert.deepEqual(parseArguments([]), {
    checkOnly: false,
    appArguments: [
      `--disable-features=${AUDIO_SERVICE_FEATURE}`,
    ],
  });
});

test("launcher merges feature flags without duplication", () => {
  assert.deepEqual(
    withDisabledFeature(
      ["--disable-features=OtherFeature"],
      AUDIO_SERVICE_FEATURE,
    ),
    [
      `--disable-features=OtherFeature,${AUDIO_SERVICE_FEATURE}`,
    ],
  );
  assert.deepEqual(
    withDisabledFeature(
      [`--disable-features=${AUDIO_SERVICE_FEATURE}`],
      AUDIO_SERVICE_FEATURE,
    ),
    [`--disable-features=${AUDIO_SERVICE_FEATURE}`],
  );
});

test("conflicting out-of-process audio enablement is rejected", () => {
  assert.throws(
    () =>
      parseArguments([
        `--enable-features=${AUDIO_SERVICE_FEATURE}`,
      ]),
    /Cannot enable/,
  );
});

test("per-launch environment is isolated and reversible", () => {
  const environment = createEnvironment(
    {
      NODE_OPTIONS: "--require=/tmp/other.cjs",
      ELECTRON_RUN_AS_NODE: "1",
      KEEP_ME: "yes",
    },
    {
      preloadPath: "/safe/preload.cjs",
    },
  );

  assert.equal(
    environment.NODE_OPTIONS,
    '--require="/safe/preload.cjs"',
  );
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(environment.KEEP_ME, "yes");
});
