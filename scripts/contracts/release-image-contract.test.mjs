// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, posix } from "node:path";
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

/**
 * Literal repository COPY forms only. Inherit named build stages, never COPY --from.
 * Unsupported forms cannot certify an importer before the first frozen install.
 * @param {string} dockerfile @param {string} importer
 */
function suppliesWorkspaceImporter(dockerfile, importer) {
  /** @type {Map<string, {cwd: string, copies: {source: string, destination: string}[]}>} */
  const stages = new Map();
  let stage = {
    cwd: "/",
    copies: /** @type {{source: string, destination: string}[]} */ ([]),
  };
  for (const raw of dockerfile.replace(/\\\n/gu, " ").split("\n")) {
    const line = raw.trim();
    const from = /^FROM (\S+)(?: AS (\S+))?$/iu.exec(line);
    if (from) {
      const inherited = stages.get(from[1] ?? "");
      stage = {
        cwd: inherited?.cwd ?? "/",
        copies: [...(inherited?.copies ?? [])],
      };
      if (from[2]) stages.set(from[2], stage);
    } else if (line.startsWith("WORKDIR ")) {
      stage.cwd = posix.resolve(stage.cwd, line.slice(8).trim());
    } else if (
      /^RUN\s/u.test(line) &&
      line.includes("pnpm install --frozen-lockfile")
    ) {
      const expected = posix.resolve("/workspace", importer);
      return stage.copies.some(({ source, destination }) => {
        if (source !== importer && !importer.startsWith(source + "/"))
          return false;
        return (
          posix.resolve(destination, posix.relative(source, importer)) ===
          expected
        );
      });
    } else if (line.startsWith("COPY ")) {
      const words = line.slice(5).trim().split(/\s+/u);
      if (words.some((word) => word.startsWith("--from="))) continue;
      while (words[0]?.startsWith("--chown=")) words.shift();
      if (
        words.some((word) => /[[\]"'$*?]/u.test(word) || word.startsWith("--"))
      )
        continue;
      const destination = words.pop();
      if (!destination) continue;
      for (const word of words) {
        const source = posix.normalize(word.replace(/^\.\//u, ""));
        const directoryDestination =
          destination.endsWith("/") || destination === ".";
        // A copied directory contributes its contents at destination; a literal
        // package.json source uses its basename only for directory destinations.
        const target =
          source.endsWith("/package.json") && directoryDestination
            ? posix.join(destination, posix.basename(source))
            : destination;
        stage.copies.push({
          source,
          destination: posix.resolve(stage.cwd, target),
        });
      }
    }
  }
  return false;
}

describe("release image contract", () => {
  it("recognizes literal importer copies only at the intended stage, location and install order", () => {
    const importer = "packages/runtime-identity/package.json";
    const start = "FROM node AS inputs\nWORKDIR /workspace\n";
    const install = "RUN pnpm install --frozen-lockfile\n";
    const file =
      "COPY packages/runtime-identity/package.json ./packages/runtime-identity/package.json\n";
    const directory =
      "COPY --chown=node:node packages/runtime-identity ./packages/runtime-identity\n";
    for (const copy of [file, directory]) {
      assert.equal(
        suppliesWorkspaceImporter(start + copy + install, importer),
        true,
      );
      assert.equal(
        suppliesWorkspaceImporter(
          start + copy + "FROM inputs AS build\n" + install,
          importer,
        ),
        true,
      );
      assert.equal(
        suppliesWorkspaceImporter(start + install + copy, importer),
        false,
      );
      assert.equal(
        suppliesWorkspaceImporter(
          start +
            copy +
            "FROM node AS unrelated\nWORKDIR /workspace\n" +
            install,
          importer,
        ),
        false,
      );
    }
    for (const copy of [
      "",
      "COPY packages/other ./packages/runtime-identity\n",
      "COPY packages/runtime-identity ./wrong\n",
      "COPY packages/runtime-identity/package.json ./wrong/package.json\n",
      "COPY --from=other packages/runtime-identity ./packages/runtime-identity\n",
    ])
      assert.equal(
        suppliesWorkspaceImporter(start + copy + install, importer),
        false,
      );
  });

  it("supplies every workspace importer before frozen install in all application Docker contexts", () => {
    for (const path of [
      "apps/backend/Dockerfile",
      "apps/web/Dockerfile",
      "apps/telegram/infra/production/Dockerfile",
    ]) {
      const dockerfile = read(path);
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
          suppliesWorkspaceImporter(dockerfile, importer),
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
      /^FROM ghcr\.io\/sachkov-inside\/node:26\.10\.0-alpine3\.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS backend-production$/mu,
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
