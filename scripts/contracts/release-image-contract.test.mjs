// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { z } from "zod";

import { readPackageManifest } from "../package-manifest.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
/** @param {string} path */
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("release image contract", () => {
  it("supplies every workspace importer before frozen install in all application Docker contexts", () => {
    for (const path of [
      "apps/backend/Dockerfile",
      "apps/web/Dockerfile",
      "apps/telegram/infra/production/Dockerfile",
    ]) {
      const dockerfile = read(path);
      const dependencyStage = dockerfile.slice(
        0,
        dockerfile.indexOf("pnpm install --frozen-lockfile"),
      );
      for (const importer of [
        "apps/backend/package.json",
        "apps/web/package.json",
        "apps/telegram/package.json",
        "packages/runtime-identity/package.json",
        "packages/material-blocks",
        "packages/legal",
        "packages/access-capabilities",
      ]) {
        assert.ok(
          dependencyStage.includes(` ${importer} `),
          `${path} must supply root workspace importer ${importer} before frozen install`,
        );
      }
    }
  });

  it("builds and deploys only Telegram from the root context with an independent workflow", () => {
    const dockerfile = read("apps/telegram/infra/production/Dockerfile");
    assert.match(dockerfile, /COPY.*tsconfig\.nest-app\.json/u);
    assert.match(dockerfile, /COPY.*apps\/telegram\/src/u);
    assert.match(dockerfile, /pnpm --filter @inside\/telegram build/u);
    assert.match(
      dockerfile,
      /--filter @inside\/telegram deploy --prod --ignore-scripts/u,
    );
    assert.match(dockerfile, /pnpm --config\.inject-workspace-packages=true/u);
    assert.match(dockerfile, /deploy.*--frozen-lockfile/u);
    assert.doesNotMatch(dockerfile, /deploy.*--(?:prefer-)?offline/u);
    assert.match(
      dockerfile,
      /COPY --from=build.*\/workspace\/apps\/telegram\/dist \.\/dist/u,
    );
    assert.doesNotMatch(dockerfile, /pnpm prune/u);
    assert.match(
      read(".github/workflows/ci.yml"),
      /docker build --no-cache --file apps\/telegram\/infra\/production\/Dockerfile/u,
    );
    const telegram = read(".github/workflows/telegram-release.yml");
    assert.match(telegram, /context: \.$/mu);
    assert.match(
      telegram,
      /file: apps\/telegram\/infra\/production\/Dockerfile/u,
    );
    assert.match(telegram, /uses: \.\/\.github\/workflows\/ci\.yml/u);
    assert.doesNotMatch(read(".github/workflows/release.yml"), /telegram-v/u);
  });

  it("ships backend and web production targets without a runtime source checkout", () => {
    const rootPackage = readPackageManifest(
      resolve(repositoryRoot, "package.json"),
    );
    const backendDockerfile = read("apps/backend/Dockerfile");
    const backendProduction = z
      .object({ files: z.array(z.string()) })
      .passthrough()
      .parse(JSON.parse(read("apps/backend/tsconfig.production.json")));
    const smoke = read("scripts/release-image-smoke.sh");
    const ci = read(".github/workflows/ci.yml");
    const images = spawnSync(
      process.execPath,
      ["scripts/release-contract.mjs", "images"],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
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
    assert.match(
      backendDockerfile,
      /^FROM public\.ecr\.aws\/docker\/library\/node:.* AS backend-production$/mu,
    );
    assert.match(
      backendDockerfile,
      /^FROM backend-production AS api-production$/mu,
    );
    for (const entrypoint of [
      "src/entrypoints/api.ts",
      "src/entrypoints/mcp.ts",
      "src/entrypoints/material-assets-worker.ts",
      "src/entrypoints/profile-avatars-worker.ts",
      "src/entrypoints/video-deletions-worker.ts",
      "src/migrations/migrate.ts",
    ]) {
      assert.ok(
        backendProduction.files.includes(entrypoint),
        `${entrypoint} must ship`,
      );
      assert.match(
        smoke,
        new RegExp(
          entrypoint.replace(/^src\//u, "dist/").replace(/\.ts$/u, "\\.js"),
          "u",
        ),
      );
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
    assert.equal(
      rootPackage.scripts["release:images:smoke"],
      "bash scripts/heavy-check.sh bash scripts/release-image-smoke.sh",
    );
    assert.match(ci, /run: pnpm release:images:smoke/u);
  });
});
