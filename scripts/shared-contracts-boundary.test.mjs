// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const check = new URL("./check-shared-contracts-boundary.mjs", import.meta.url);
/** @param {(root: string) => void} prepare */
function run(prepare) {
  const root = mkdtempSync(path.join(tmpdir(), "inside-contracts-"));
  try {
    put(root, "docs/contracts/notifications-v1/schema.json", {
      $id: "https://fixture.test/contracts/test.schema.json",
      type: "object",
    });
    put(root, "docs/contracts/notifications-v1/fixtures.json", [
      { valid: true },
    ]);
    prepare(root);
    return spawnSync(process.execPath, [check.pathname, root], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
/** @param {string} root @param {string} file @param {unknown} value */
function put(root, file, value) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value));
}

test("accepts consumers importing the canonical corpus", () => {
  const result = run((root) =>
    put(root, "apps/telegram/package.json", {
      dependencies: { "@inside/contracts": "workspace:*" },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a changed schema with the canonical identity under another name", () => {
  const result = run((root) =>
    put(root, "apps/telegram/src/foreign.json", {
      $id: "https://fixture.test/contracts/test.schema.json",
      type: "string",
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/telegram\/src\/foreign.json/u);
});

test("rejects renamed fixtures copied outside the authority", () => {
  const result = run((root) =>
    put(root, "packages/copy/examples.json", [{ valid: true }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /packages\/copy\/examples.json/u);
});

test("rejects modified fixtures in a second contract folder", () => {
  const result = run((root) =>
    put(
      root,
      "apps/telegram/docs/contracts/notifications-v1/fixtures.json",
      [],
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/telegram\/docs\/contracts/u);
});

test("rejects a second canonical schema with the same identity", () => {
  const result = run((root) =>
    put(root, "docs/contracts/another/schema.json", {
      $id: "https://fixture.test/contracts/test.schema.json",
      type: "string",
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/contracts\/another\/schema.json|docs\/contracts\/notifications-v1\/schema.json/u,
  );
});

test("rejects a TypeScript schema copy in application source", () => {
  const result = run((root) => {
    const file = path.join(root, "apps/telegram/src/schema-copy.ts");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      'export const schema = { $id: "https://fixture.test/contracts/test.schema.json", type: "string" };',
    );
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/telegram\/src\/schema-copy.ts/u);
});

test("rejects provider corpus drift from its current OpenAPI operation", () => {
  const result = run((root) => {
    put(root, "docs/contracts/platform-billing-cohorts/schema.json", {
      response: { type: "string" },
    });
    put(root, "apps/backend/openapi/platform-api.json", {
      paths: {
        "/billing/cohorts": {
          get: {
            operationId: "billingProductCohorts",
            responses: {
              200: {
                content: { "application/json": { schema: { type: "object" } } },
              },
            },
          },
        },
      },
    });
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /platform-billing-cohorts.*OpenAPI/u);
});

test("rejects an executable schema copy in root tooling", () => {
  for (const directory of ["scripts", "tools"]) {
    const result = run((root) => {
      const file = path.join(root, directory, "schema-copy.mjs");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        'export const schema = { $id: "https://fixture.test/contracts/test.schema.json", type: "string" };',
      );
    });
    assert.equal(result.status, 1, directory);
    assert.match(
      result.stderr,
      new RegExp(`${directory}/schema-copy.mjs`, "u"),
    );
  }
});
