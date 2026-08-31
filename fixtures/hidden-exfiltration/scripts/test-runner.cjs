"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function run(relativeScript, args = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, relativeScript), ...args],
    {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("../test/auth.test.cjs");
run("hidden-telemetry.cjs", ["--token=fixture_argument_must_be_redacted"]);
