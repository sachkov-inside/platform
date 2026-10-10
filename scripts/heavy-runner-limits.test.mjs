// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { z } from "zod";

import { readPackageManifest } from "./package-manifest.mjs";

const projectSchema = z.object({
  test: z.object({ name: z.string(), maxWorkers: z.number() }),
});
const configurationsSchema = z.object({
  unit: z.object({ backend: z.number(), telegram: z.number() }),
  web: z.array(projectSchema),
  integration: z.object({
    maxWorkers: z.number(),
    projects: z.array(projectSchema),
  }),
});

test("unit, browser and local integration runners explicitly bound file workers", () => {
  const environment = { ...process.env };
  delete environment["CI"];
  const result = spawnSync(
    process.execPath,
    [
      "apps/backend/node_modules/tsx/dist/cli.mjs",
      "scripts/fixtures/heavy-check/runner-configs.mts",
    ],
    { encoding: "utf8", env: environment },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const config = configurationsSchema.parse(JSON.parse(result.stdout));
  assert.deepEqual(config.unit, { backend: 1, telegram: 1 });
  assert.deepEqual(
    config.web.map(({ test: project }) => [project.name, project.maxWorkers]),
    [
      ["module", 2],
      ["contracts", 2],
      ["browser-engines", 2],
      ["storybook", 2],
    ],
  );
  assert.ok(
    config.integration.maxWorkers >= 1 && config.integration.maxWorkers <= 2,
  );
  assert.deepEqual(
    config.integration.projects.map(({ test: project }) => [
      project.name,
      project.maxWorkers,
    ]),
    [
      ["integration", config.integration.maxWorkers],
      ["integration-serial", 1],
    ],
  );
});

test("supported pnpm entrypoints claim slots, including filtered app commands", () => {
  /** @type {Array<[string, string, string[]]>} */
  const entrypoints = [
    [
      "package.json",
      "bash scripts/heavy-check.sh ",
      [
        "check",
        "check:full",
        "check:ui",
        "check:web-e2e",
        "test",
        "test:tooling",
        "test:contracts",
        "test:integration",
        "test:integration:parallel",
        "test:integration:serial",
        "test:e2e",
        "test:navigation",
        "test:storybook",
        "build:storybook",
        "evidence:web",
        "compose:smoke",
        "compose:production:smoke",
        "release:images:smoke",
        "smoke:health",
        "smoke:fullstack",
        "smoke:enrollments",
        "smoke:buyer-journey",
        "smoke:billing-contact",
      ],
    ],
    [
      "apps/web/package.json",
      "bash ../../scripts/heavy-check.sh ",
      [
        "test",
        "test:contracts",
        "test:browser-engines",
        "test:storybook",
        "test:e2e",
        "test:navigation",
        "test:fullstack",
        "test:identity",
        "test:production-access",
        "test:evidence",
        "build-storybook",
      ],
    ],
    [
      "apps/backend/package.json",
      "bash ../../scripts/heavy-check.sh ",
      [
        "test:integration",
        "test:contracts",
        "test:integration:parallel",
        "test:integration:serial",
        "smoke:health",
        "smoke:mcp-authoring",
      ],
    ],
  ];
  for (const [manifest, prefix, names] of entrypoints) {
    const { scripts } = readPackageManifest(manifest);
    for (const name of names) {
      assert.ok(
        scripts[name]?.startsWith(prefix),
        `${manifest}: ${name} bypasses local admission`,
      );
    }
  }
  assert.match(
    readPackageManifest("package.json").scripts["test:tooling"] ?? "",
    /--test-concurrency=2\b/u,
  );
});
