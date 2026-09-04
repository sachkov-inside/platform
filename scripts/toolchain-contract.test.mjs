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

  it("allows local previews and protected image delivery through the Web CSP", () => {
    const nextConfig = read("apps/web/next.config.ts");

    assert.match(
      nextConfig,
      /"img-src 'self' data: blob: http:\/\/127\.0\.0\.1:\* http:\/\/localhost:9000 https:\/\/storage\.yandexcloud\.net/u,
    );
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
    const localImageLines = read("compose.yaml")
      .split("\n")
      .filter((line) => /^\s*image:/u.test(line));
    assert.ok(localImageLines.length > 0);
    assert.ok(localImageLines.every((line) => {
      const image = line.trim();
      return /:[A-Za-z0-9][^\s@]*$/u.test(image) && !/:latest$/u.test(image);
    }));
    assert.match(read("compose.production.yaml"), /PLATFORM_BACKEND_IMAGE_DIGEST/u);
    assert.match(read("compose.production.yaml"), /PLATFORM_WEB_IMAGE_DIGEST/u);
  });

  it("keeps production runtime independent from the checked-out source", () => {
    const productionCompose = read("compose.production.yaml");

    assert.doesNotMatch(productionCompose, /^\s+build:/mu);
    assert.match(productionCompose, /PLATFORM_BACKEND_IMAGE_DIGEST/u);
    assert.match(productionCompose, /PLATFORM_WEB_IMAGE_DIGEST/u);
  });

  it("runs every current production process with explicit networks", () => {
    const productionCompose = read("compose.production.yaml");

    for (const service of [
      "migrations",
      "api",
      "mcp",
      "material-assets-worker",
      "profile-avatars-worker",
      "video-deletions-worker",
      "web",
    ]) assert.match(productionCompose, new RegExp(`^  ${service}:$`, "mu"));
    assert.match(productionCompose, /^networks:$/mu);
    assert.match(productionCompose, /FOUNDATION_DATABASE_NETWORK/u);
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
      "config/compose/local/video-deletions-worker.env",
      "config/compose/local/web.env",
      "config/compose/local/storybook.env",
      "config/compose/production/compose.env.example",
      "config/compose/production/runtime.env.example",
      "config/compose/production/migrations.env.example",
      "config/compose/production/api.env.example",
      "config/compose/production/mcp.env.example",
      "config/compose/production/material-assets-worker.env.example",
      "config/compose/production/profile-avatars-worker.env.example",
      "config/compose/production/video-deletions-worker.env.example",
      "config/compose/production/web.env.example",
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
    assert.match(smoke, /^PGBACKREST_ARCHIVE_ASYNC=n$/mu);
    assert.doesNotMatch(smoke, /down --rmi local --volumes --remove-orphans \|\| true/u);
  });

  it("checks every worker readiness without a pipefail-sensitive grep", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.doesNotMatch(smoke, /\|\s*rg(?:\s|$)/u);
    assert.match(smoke, /for worker in material-assets-worker profile-avatars-worker video-deletions-worker/u);
    assert.match(smoke, /running:healthy:0/u);
    assert.match(smoke, /did not report release\/schema readiness/u);
  });

  it("proves an in-flight PgBoss job completes during worker drain", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /wait_for_pgboss_job_state "\$drain_job_id" active/u);
    assert.match(smoke, /docker kill --signal TERM "\$old_worker_container"/u);
    assert.match(smoke, /exited before its in-flight PgBoss job could drain/u);
    assert.match(smoke, /pg_terminate_backend\(\$\{worker_drain_lock_backend_pid\}\)/u);
    assert.match(smoke, /wait_for_pgboss_job_state "\$drain_job_id" completed/u);
  });

  it("runs fresh, upgrade, and N-1 migration compatibility fixtures", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /inside_fresh/u);
    assert.match(smoke, /platformMigrations\.slice\(0, -1\)/u);
    assert.match(
      smoke,
      /fixtures\/production-runtime\/n-minus-one-compatibility\.mjs/u,
    );
    assert.doesNotMatch(smoke, /down.?migrat/iu);
  });

  it("keeps the migration entrypoint mode-aware for local and production runs", () => {
    const migrationEntrypoint = read("apps/backend/src/migrations/migrate.ts");

    assert.match(
      migrationEntrypoint,
      /parseRuntimeIdentity\(\s*process\.env,\s*parsePlatformMode\(process\.env\.NODE_ENV\)/u,
    );
    assert.doesNotMatch(
      migrationEntrypoint,
      /parseRuntimeIdentity\(process\.env,\s*"production"\)/u,
    );
  });

  it("proves trusted TLS and rejects a wrong hostname", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /caddy-root\.crt/u);
    assert.match(smoke, /TLS unexpectedly accepted the wrong hostname/u);
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
