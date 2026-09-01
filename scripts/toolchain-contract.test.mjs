import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const rootPackage = JSON.parse(read("package.json"));
const backendPackage = JSON.parse(read("apps/backend/package.json"));
const webPackage = JSON.parse(read("apps/web/package.json"));
const nodeVersion = read(".node-version").trim();
const pnpmVersion = rootPackage.packageManager.replace(/^pnpm@/u, "");
const applicationDockerfiles = ["apps/backend/Dockerfile", "apps/web/Dockerfile"];

describe("supported toolchain contract", () => {
  it("keeps Docker on the repository Node and pnpm pins", () => {
    for (const path of applicationDockerfiles) {
      const dockerfile = read(path);

      assert.match(
        dockerfile,
        new RegExp(`^FROM node:${escapeRegExp(nodeVersion)}-alpine\\d+\\.\\d+ AS toolchain$`, "mu"),
      );
      assert.match(
        dockerfile,
        new RegExp(`corepack install --global pnpm@${escapeRegExp(pnpmVersion)}(?:\\s|$)`, "u"),
      );
    }
  });

  it("copies Prisma generation inputs before dependency postinstall", () => {
    for (const path of applicationDockerfiles) {
      const dockerfile = read(path);
      const installPosition = dockerfile.indexOf("pnpm install --frozen-lockfile");

      assert.ok(installPosition > 0);
      for (const input of [
        "apps/backend/prisma.config.ts",
        "apps/backend/prisma ./apps/backend/prisma",
      ]) {
        const copyPosition = dockerfile.indexOf(input);
        assert.ok(copyPosition >= 0, `${path} must copy ${input}`);
        assert.ok(
          copyPosition < installPosition,
          `${path} must copy ${input} before pnpm install`,
        );
      }
    }
  });

  it("keeps TypeScript exact and Node declarations on the runtime major", () => {
    const nodeMajor = nodeVersion.split(".")[0];
    const packages = [rootPackage, backendPackage, webPackage];
    const typeScriptPins = packages.map((manifest) => manifest.devDependencies.typescript);

    assert.equal(new Set(typeScriptPins).size, 1);
    assert.equal(typeScriptPins[0], "7.0.2");
    assert.ok(typeScriptPins.every((version) => /^\d+\.\d+\.\d+$/u.test(version)));
    for (const manifest of [backendPackage, webPackage]) {
      assert.equal(manifest.devDependencies["@types/node"].split(".")[0], nodeMajor);
    }
  });

  it("keeps editors, Next and CLI checks on TypeScript 7 projects", () => {
    const editorSettings = JSON.parse(read(".vscode/settings.json"));
    const backendTypeScript = JSON.parse(read("apps/backend/tsconfig.json"));
    const webTypeScript = JSON.parse(read("apps/web/tsconfig.json"));
    const nextTypeScript = JSON.parse(read("apps/web/tsconfig.next.json"));
    const nextConfig = read("apps/web/next.config.ts");

    assert.equal(
      editorSettings["js/ts.tsdk.path"],
      "./node_modules/typescript/lib",
    );
    assert.equal(
      editorSettings["js/ts.tsdk.promptToUseWorkspaceVersion"],
      true,
    );
    assert.equal(
      backendTypeScript.compilerOptions.experimentalDecorators,
      true,
    );
    assert.ok(backendTypeScript.include.includes("src/**/*.ts"));
    assert.ok(webTypeScript.include.includes(".next/types/**/*.ts"));
    assert.ok(!webTypeScript.include.includes(".next/dev/types/**/*.ts"));
    assert.ok(webTypeScript.exclude.includes(".next/dev"));
    assert.equal(nextTypeScript.extends, "./tsconfig.json");
    assert.ok(nextTypeScript.include.includes(".next/dev/types/**/*.ts"));
    assert.doesNotMatch(nextConfig, /useTypeScriptCli:\s*false/u);
    assert.match(nextConfig, /tsconfigPath: "tsconfig\.next\.json"/u);
  });

  it("uses only the Oxc lint and parser toolchain", () => {
    assert.equal(
      rootPackage.scripts.lint,
      "oxlint --deny-warnings --report-unused-disable-directives --ignore-pattern 'apps/backend/test/guardrails/fixtures/oxlint/**' .",
    );
    assert.equal(rootPackage.devDependencies.oxlint, "1.80.0");
    assert.equal(rootPackage.devDependencies["oxlint-tsgolint"], "7.0.2001");
    assert.equal(rootPackage.devDependencies["oxc-parser"], "0.147.0");

    for (const dependency of [
      "eslint",
      "typescript-eslint",
      "@eslint/js",
      "@next/eslint-plugin-next",
      "@tanstack/eslint-plugin-query",
      "eslint-plugin-react-hooks",
      "eslint-plugin-storybook",
    ]) {
      assert.equal(rootPackage.devDependencies[dependency], undefined);
    }
  });

  it("keeps TypeScript-API consumers out of active Web tooling", () => {
    assert.equal(webPackage.devDependencies["@storybook/nextjs-vite"], undefined);
    assert.equal(webPackage.devDependencies["@storybook/addon-mcp"], undefined);
    assert.equal(webPackage.devDependencies["@storybook/react-vite"], "10.5.10");
    assert.equal(
      webPackage.devDependencies["openapi-typescript-codegen"],
      "0.31.0",
    );
    assert.equal(webPackage.devDependencies["openapi-typescript"], undefined);
    assert.equal(webPackage.dependencies["openapi-fetch"], undefined);
    assert.doesNotMatch(read("pnpm-workspace.yaml"), /^overrides:/mu);
  });

  it("uses explicit container version tags", () => {
    for (const path of ["compose.yaml", "compose.production.yaml"]) {
      const imageLines = read(path)
        .split("\n")
        .filter((line) => /^\s*image:/u.test(line));
      assert.ok(imageLines.length > 0, `${path} must declare at least one image`);
      assert.ok(
        imageLines.every((line) => {
          const image = line.trim();
          return /:[A-Za-z0-9][^\s@]*$/u.test(image) && !/:latest$/u.test(image);
        }),
        `${path} contains an image without an explicit version tag`,
      );
    }
  });

  it("keeps the production baseline buildable from the checked-out source", () => {
    const productionCompose = read("compose.production.yaml");

    for (const service of ["migrations", "api", "web"]) {
      assert.match(
        productionCompose,
        new RegExp(`  ${service}:\\n(?:    .*\\n)*?    build:\\n`, "u"),
      );
    }
    assert.doesNotMatch(productionCompose, /PLATFORM_(?:API|WEB|MIGRATION)_IMAGE/u);
    assert.doesNotMatch(productionCompose, /@sha256:/u);
  });

  it("keeps the production teaching baseline intentionally small", () => {
    const productionCompose = read("compose.production.yaml");

    assert.doesNotMatch(productionCompose, /^ {2}database-roles:/mu);
    assert.doesNotMatch(productionCompose, /^ {2}database-access:/mu);
    assert.doesNotMatch(productionCompose, /^ {2}material-assets-worker:/mu);
    assert.doesNotMatch(productionCompose, /^networks:/mu);
    const avatarWorker = productionCompose.match(
      /\n {2}profile-avatars-worker:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u,
    );
    assert.ok(avatarWorker, "production must run Profile Avatar cleanup");
    assert.match(avatarWorker[1], /dockerfile: apps\/backend\/Dockerfile/u);
    assert.match(avatarWorker[1], /target: api-production/u);
    assert.match(avatarWorker[1], /profile-avatars-worker\.env/u);
  });

  it("keeps runtime configuration in service-owned env files", () => {
    const localCompose = read("compose.yaml");
    const productionCompose = read("compose.production.yaml");

    assert.doesNotMatch(`${localCompose}\n${productionCompose}`, /^\s+environment:/mu);
    assert.doesNotMatch(localCompose, /^ {2}bootstrap:/mu);
    assert.match(localCompose, /^ {2}migrations:/mu);
    assert.match(localCompose, /^ {2}seed:/mu);

    for (const path of [
      "config/compose/local/object-storage.env",
      "config/compose/local/postgres.env",
      "config/compose/local/migrations.env",
      "config/compose/local/seed.env",
      "config/compose/local/api.env",
      "config/compose/local/mcp.env",
      "config/compose/local/material-assets-worker.env",
      "config/compose/local/profile-avatars-worker.env",
      "config/compose/local/web.env",
      "config/compose/local/storybook.env",
      "config/compose/production/compose.env.example",
      "config/compose/production/postgres.env.example",
      "config/compose/production/migrations.env.example",
      "config/compose/production/api.env.example",
      "config/compose/production/profile-avatars-worker.env.example",
      "config/compose/production/web.env.example",
      "config/compose/production/caddy.env.example",
    ]) {
      assert.ok(read(path).trim().length > 0, `${path} must not be empty`);
    }
  });

  it("keeps production native dependencies and excludes development scripts", () => {
    assert.match(
      read("apps/backend/Dockerfile"),
      /deploy --prod --ignore-scripts \/workspace\/\.production\/backend/u,
    );
  });

  it("isolates production smoke resources and removes local build images", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /project_name="inside-platform-production-smoke-\$\$"/u);
    assert.match(smoke, /down --rmi local --volumes --remove-orphans/u);
    assert.match(smoke, /local test_status=\$\?/u);
    assert.doesNotMatch(smoke, /down --rmi local --volumes --remove-orphans \|\| true/u);
  });

  it("checks Profile Avatar worker readiness without a pipefail-sensitive grep", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.doesNotMatch(smoke, /\|\s*rg(?:\s|$)/u);
    assert.match(
      smoke,
      /\[\[ "\$avatar_worker_logs" != \*'"process":"profile-avatars-worker","status":"ready"'\* \]\]/u,
    );
  });

  it("derives the production migration expectation from the registered source files", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /expected_migration_count=/u);
    assert.match(smoke, /infrastructure\/postgres\/migrations/u);
    assert.doesNotMatch(smoke, /migration_count" != "\d+"/u);
  });

  it("retries transient TLS failures in the production smoke", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.equal(smoke.match(/--retry-all-errors/gu)?.length, 2);
  });

  it("keeps Profile Avatar cleanup grace in service-owned env files", () => {
    const developmentCompose = read("compose.yaml");
    const workerBlock = developmentCompose.match(
      /\n {2}profile-avatars-worker:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u,
    );

    assert.ok(workerBlock, "compose.yaml must declare profile-avatars-worker");
    assert.match(workerBlock[1], /profile-avatars-worker\.env/u);
    for (const path of [
      "config/compose/local/profile-avatars-worker.env",
      "config/compose/production/api.env.example",
      "config/compose/production/profile-avatars-worker.env.example",
    ]) {
      assert.match(read(path), /^PROFILE_AVATAR_ORPHAN_GRACE_SECONDS=86400$/mu);
    }
  });

  it("groups only patch/minor Dependabot updates", () => {
    const dependabot = read(".github/dependabot.yml");
    const groupBodies = [...dependabot.matchAll(/^\s{6}(\S+):\n((?:\s{8,}.*\n?)*)/gmu)];

    assert.ok(groupBodies.length > 0);
    for (const [, name, body] of groupBodies) {
      assert.match(body, /^\s{8}update-types: \[minor, patch\]$/mu, `${name} can mix major updates`);
    }
  });

  it("schema-qualifies Materials tables in the Compose smoke query", () => {
    const smoke = read("scripts/compose-stack-smoke.sh");

    assert.match(smoke, /from materials\.materials\b/u);
    assert.match(smoke, /\bcontent_version\b/u);
    assert.match(smoke, /\bpublication_state\b/u);
    assert.doesNotMatch(smoke, /\bfrom materials\b(?!\.)/u);
  });

  it("matches captured MCP logs without a pipefail-sensitive quiet grep", () => {
    const smoke = read("scripts/compose-stack-smoke.sh");

    assert.match(smoke, /mcp_logs="\$\(docker compose logs --no-color mcp\)"/u);
    assert.match(smoke, /\[\[ "\$mcp_logs" != \*/u);
    assert.doesNotMatch(
      smoke,
      /docker compose logs --no-color mcp\s*\|\s*grep --quiet/u,
    );
  });

  it("keeps local Compose free of Watch automation", () => {
    const compose = read("compose.yaml");

    assert.doesNotMatch(compose, /^x-.*-develop:/mu);
    assert.doesNotMatch(compose, /^\s+(?:develop|watch):/mu);
    assert.doesNotMatch(read("package.json"), /compose:dev|--watch/u);
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
