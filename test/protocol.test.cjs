"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  createEnvironment,
  parseArguments,
} = require("../src/launch.cjs");
const {
  attachToElectron,
} = require("../src/preload.cjs");

test("launcher protocol is accepted by the preload", () => {
  const { appArguments } = parseArguments([]);
  assert.deepEqual(appArguments, [
    "--disable-features=AudioServiceOutOfProcess",
  ]);

  const environment = createEnvironment(
    {},
    {
      preloadPath: "/safe/preload.cjs",
    },
  );
  assert.equal(
    environment.NODE_OPTIONS,
    '--require="/safe/preload.cjs"',
  );
  const app = new EventEmitter();
  app.commandLine = { getSwitchValue: () => "" };
  app.whenReady = () => new Promise(() => {});
  const capture = {
    dispose() {},
    getStatus: () => "waiting",
  };
  assert.equal(
    attachToElectron(
      { app },
      capture,
      {
        argumentsList: appArguments,
        installRenderer: () => ({
          dispose() {},
          ready: new Promise(() => {}),
        }),
      },
    ),
    true,
  );
  app.emit("will-quit");
});
