import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("release image contract", () => {
  it("ships backend and web production targets without a runtime source checkout", () => {
    const rootPackage = JSON.parse(read("package.json"));
    const backendDockerfile = read("apps/backend/Dockerfile");
    const backendProduction = JSON.parse(read("apps/backend/tsconfig.production.json"));
    const smoke = read("scripts/release-image-smoke.sh");
    const ci = read(".github/workflows/ci.yml");

    assert.match(backendDockerfile, /^FROM node:.* AS backend-production$/mu);
    assert.match(backendDockerfile, /^FROM backend-production AS api-production$/mu);
    for (const entrypoint of [
      "src/entrypoints/api.ts",
      "src/entrypoints/mcp.ts",
      "src/entrypoints/material-assets-worker.ts",
      "src/entrypoints/profile-avatars-worker.ts",
      "src/entrypoints/video-deletions-worker.ts",
      "src/migrations/migrate.ts",
    ]) {
      assert.ok(backendProduction.files.includes(entrypoint), `${entrypoint} must ship`);
      assert.match(smoke, new RegExp(entrypoint.replace(/^src\//u, "dist/").replace(/\.ts$/u, "\\.js"), "u"));
    }
    assert.match(smoke, /docker build .*--target backend-production/u);
    assert.match(smoke, /docker build .*--target web-production/u);
    assert.match(smoke, /test ! -e \/workspace/u);
    assert.match(smoke, /test ! -d \/app\/src/u);
    assert.equal(rootPackage.scripts["release:images:smoke"], "bash scripts/release-image-smoke.sh");
    assert.match(ci, /run: pnpm release:images:smoke/u);
  });
});
