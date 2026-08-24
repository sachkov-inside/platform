import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateDoctor } from "./doctor.mjs";

const expected = { nodeVersion: "24.19.0", pnpmVersion: "11.22.0" };
const healthyFacts = {
  nodeVersion: "24.19.0",
  pnpmVersion: "11.22.0",
  environmentFileExists: true,
  dockerCli: { ok: true, output: "Docker 28" },
  composePlugin: { ok: true, output: "Docker Compose 2" },
  dockerDaemon: { ok: true, output: "28.0.0" },
  postgresComposeRunning: false,
  occupiedPorts: [],
};

describe("Platform doctor", () => {
  it("accepts the pinned local development environment", () => {
    assert.equal(
      evaluateDoctor(healthyFacts, expected).every((check) => check.ok),
      true,
    );
  });

  it("explains a wrong Node version and unavailable Docker daemon", () => {
    const checks = evaluateDoctor(
      {
        ...healthyFacts,
        nodeVersion: "22.23.1",
        dockerDaemon: { ok: false, output: "Cannot connect to Docker" },
      },
      expected,
    );

    assert.deepEqual(
      checks
        .filter((check) => !check.ok)
        .map((check) => ({ name: check.name, fix: check.fix })),
      [
        {
          name: "Node.js",
          fix: "Install and select Node 24.19.0 from .node-version (for example: fnm use).",
        },
        { name: "Docker daemon", fix: "Start Docker and wait until the daemon is ready." },
      ],
    );
  });

  it("accepts PostgreSQL port ownership only from the Platform Compose project", () => {
    const accepted = evaluateDoctor(
      { ...healthyFacts, postgresComposeRunning: true, occupiedPorts: [5432] },
      expected,
    );
    const rejected = evaluateDoctor(
      { ...healthyFacts, postgresComposeRunning: false, occupiedPorts: [5432] },
      expected,
    );

    assert.equal(accepted.every((check) => check.ok), true);
    assert.equal(rejected.find((check) => check.name === "Port 5432")?.ok, false);
  });
});
