import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("release image contract", () => {
  it("ships backend and web production targets without a runtime source checkout", () => {
    const rootPackage = JSON.parse(read("package.json"));
    const backendDockerfile = read("apps/backend/Dockerfile");
    const backendProduction = JSON.parse(read("apps/backend/tsconfig.production.json"));
    const smoke = read("scripts/release-image-smoke.sh");
    const ci = read(".github/workflows/ci.yml");
    const images = spawnSync(
      process.execPath,
      ["scripts/release-contract.mjs", "images"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    assert.equal(images.status, 0, images.stderr);
    assert.deepEqual(JSON.parse(images.stdout), [
      {
        kind: "backend",
        dockerfile: "apps/backend/Dockerfile",
        target: "backend-production",
        imageName: "ghcr.io/sachkov-inside/platform-backend",
      },
      {
        kind: "web",
        dockerfile: "apps/web/Dockerfile",
        target: "web-production",
        imageName: "ghcr.io/sachkov-inside/platform-web",
      },
    ]);
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
    assert.equal(smoke.match(/^ {2}docker build \\/gmu)?.length, 1);
    assert.equal(smoke.match(/^ {4}--provenance=false \\/gmu)?.length, 1);
    assert.equal(smoke.match(/^ {4}--sbom=false \\/gmu)?.length, 1);
    assert.match(smoke, /release-contract\.mjs images/u);
    assert.match(smoke, /release-schema-identity\.sh/u);
    assert.match(smoke, /docker image inspect/u);
    assert.doesNotMatch(smoke, /apps\/(?:backend|web)\/Dockerfile/u);
    assert.doesNotMatch(smoke, /(?:backend|web)-production/u);
    assert.match(smoke, /test ! -e \/workspace/u);
    assert.match(smoke, /test ! -d \/app\/src/u);
    assert.equal(rootPackage.scripts["release:images:smoke"], "bash scripts/release-image-smoke.sh");
    assert.match(ci, /run: pnpm release:images:smoke/u);
  });
});
