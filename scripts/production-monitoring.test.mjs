// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("monitoring configuration, pilot identity and MCP sample contracts", () => {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts",
      "-p",
      "test_monitoring_*.py",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("monitoring permissions preserve release-owned watchdog execution", () => {
  const override = readFileSync(
    "infra/production/monitoring/watchdog-metrics.conf",
    "utf8",
  );
  assert.match(override, /ReadWritePaths=\/var\/lib\/inside\/metrics/u);
  assert.doesNotMatch(override, /^ExecStart=/mu);
  const installer = readFileSync(
    "infra/production/monitoring/monitoringctl",
    "utf8",
  );
  assert.doesNotMatch(
    installer,
    /install .*inside-watchdog.*\/usr\/local\/libexec/u,
  );
});
