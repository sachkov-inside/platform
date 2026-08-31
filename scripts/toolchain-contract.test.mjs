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

describe("supported toolchain contract", () => {
  it("keeps Docker on the repository Node and pnpm pins", () => {
    const dockerfile = read("Dockerfile");

    assert.match(
      dockerfile,
      new RegExp(`^FROM node:${escapeRegExp(nodeVersion)}-alpine\\d+\\.\\d+@sha256:[a-f0-9]{64} AS toolchain$`, "mu"),
    );
    assert.match(
      dockerfile,
      new RegExp(`corepack install --global pnpm@${escapeRegExp(pnpmVersion)}(?:\\s|$)`, "u"),
    );
  });

  it("copies Prisma generation inputs before dependency postinstall", () => {
    const dockerfile = read("Dockerfile");
    const installPosition = dockerfile.indexOf("pnpm install --frozen-lockfile");

    assert.ok(installPosition > 0);
    for (const input of [
      "apps/backend/prisma.config.ts",
      "apps/backend/prisma ./apps/backend/prisma",
    ]) {
      const copyPosition = dockerfile.indexOf(input);
      assert.ok(copyPosition >= 0, `Dockerfile must copy ${input}`);
      assert.ok(
        copyPosition < installPosition,
        `Dockerfile must copy ${input} before pnpm install`,
      );
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

  it("pins every container image by digest and every GitHub Action by commit", () => {
    for (const path of [
      "compose.yaml",
      "compose.production.yaml",
      ".github/workflows/application-ci.yml",
    ]) {
      const imageLines = read(path)
        .split("\n")
        .filter(
          (line) =>
            /^\s*image:/u.test(line) && !line.includes("${PLATFORM_"),
        );
      assert.ok(imageLines.length > 0, `${path} must declare at least one image`);
      assert.ok(
        imageLines.every((line) => /:\d[^\s]*@sha256:[a-f0-9]{64}$/u.test(line.trim())),
        `${path} contains an unpinned image`,
      );
    }

    const actionLines = read(".github/workflows/application-ci.yml")
      .split("\n")
      .filter((line) => /^\s*uses:/u.test(line));
    assert.ok(actionLines.length > 0);
    assert.ok(
      actionLines.every((line) => /@[a-f0-9]{40}(?:\s+#\s+v\d+\.\d+\.\d+)?$/u.test(line.trim())),
    );
  });

  it("keeps production application images supplied as immutable release inputs", () => {
    const productionCompose = read("compose.production.yaml");

    assert.match(
      productionCompose,
      /image: \$\{PLATFORM_API_IMAGE_REPOSITORY:\?[^}]+\}@sha256:\$\{PLATFORM_API_IMAGE_DIGEST:\?[^}]+\}/u,
    );
    assert.match(
      productionCompose,
      /image: \$\{PLATFORM_MIGRATION_IMAGE_REPOSITORY:\?[^}]+\}@sha256:\$\{PLATFORM_MIGRATION_IMAGE_DIGEST:\?[^}]+\}/u,
    );
    assert.match(
      productionCompose,
      /image: \$\{PLATFORM_WEB_IMAGE_REPOSITORY:\?[^}]+\}@sha256:\$\{PLATFORM_WEB_IMAGE_DIGEST:\?[^}]+\}/u,
    );
    assert.doesNotMatch(productionCompose, /^\s+build:/mu);
  });

  it("keeps production database and network privileges separated", () => {
    const productionCompose = read("compose.production.yaml");
    const databaseRoles = read("scripts/provision-production-database-roles.sh");

    assert.match(productionCompose, /DATABASE_URL: \$\{MIGRATION_DATABASE_URL:\?[^}]+\}/u);
    assert.match(productionCompose, /DATABASE_URL: \$\{DATABASE_URL:\?Set DATABASE_URL\}/u);
    assert.match(productionCompose, /database-roles:\n/u);
    assert.match(productionCompose, /database-access:\n/u);
    assert.match(productionCompose, /RELEASE_MIGRATION_IMAGE_DIGEST: \$\{PLATFORM_MIGRATION_IMAGE_DIGEST:\?[^}]+\}/u);
    assert.match(productionCompose, /data:\n\s+internal: true/u);
    assert.match(databaseRoles, /grant connect, create on database/u);
    assert.match(databaseRoles, /nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/u);
    assert.match(databaseRoles, /grant select, insert, update, delete on all tables/u);
    assert.match(databaseRoles, /MIGRATION_DATABASE_URL does not authenticate as the restricted migration owner/u);
    assert.match(databaseRoles, /DATABASE_URL does not authenticate as the restricted application role/u);
    assert.doesNotMatch(databaseRoles, /all tables in schema public/u);
  });

  it("excludes optional build-only packages from the production API image", () => {
    assert.match(
      read("Dockerfile"),
      /deploy --prod --no-optional --ignore-scripts \/workspace\/\.production\/backend/u,
    );
  });

  it("isolates production smoke resources and removes its temporary image tags", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /smoke_suffix="\$\{source_revision:0:12\}-\$\$"/u);
    assert.match(
      smoke,
      /docker image rm "\$PLATFORM_API_BUILD_IMAGE" "\$PLATFORM_WEB_BUILD_IMAGE"/u,
    );
    assert.match(smoke, /down --volumes --remove-orphans/u);
    assert.match(smoke, /local test_status=\$\?/u);
    assert.doesNotMatch(smoke, /down --volumes --remove-orphans \|\| true/u);
  });

  it("derives the production migration expectation from the registered source files", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /expected_migration_count=/u);
    assert.match(smoke, /infrastructure\/postgres\/migrations/u);
    assert.doesNotMatch(smoke, /migration_count" != "\d+"/u);
  });

  it("runs the isolated production Compose smoke as its own CI job", () => {
    const workflow = read(".github/workflows/application-ci.yml");
    const match = workflow.match(
      /\n {2}compose-production-stack:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|$)/u,
    );

    assert.ok(match, "Application CI must declare compose-production-stack");
    const job = match[1];
    assert.match(job, /run: bash scripts\/production-compose-smoke\.sh/u);
    assert.doesNotMatch(job, /secrets\./u);
  });

  it("publishes exact main production images to GHCR without mutable tags", () => {
    const workflow = read(".github/workflows/production-images.yml");

    assert.match(workflow, /^on:\n {2}push:\n {4}branches: \[main\]$/mu);
    assert.doesNotMatch(workflow, /pull_request:/u);
    assert.match(workflow, /^permissions: \{\}$/mu);
    assert.match(workflow, /permissions:\n {6}contents: read\n {6}packages: write/u);
    assert.match(workflow, /username: \$\{\{ github\.actor \}\}/u);
    assert.match(workflow, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u);

    for (const [target, image, step] of [
      ["api-production", "platform-api", "publish-api"],
      ["web-production", "platform-web", "publish-web"],
    ]) {
      assert.match(workflow, new RegExp(`target: ${target}`, "u"));
      assert.match(
        workflow,
        new RegExp(`tags: ghcr\\.io/sachkov-inside/${image}:\\$\\{\\{ github\\.sha \\}\\}`, "u"),
      );
      assert.match(
        workflow,
        new RegExp(`${image}-digest: \\$\\{\\{ steps\\.${step}\\.outputs\\.digest \\}\\}`, "u"),
      );
    }

    assert.match(workflow, /SOURCE_REVISION=\$\{\{ github\.sha \}\}/u);
    assert.doesNotMatch(workflow, /(?:^|:)latest(?:\s|$)/mu);
    const secretNames = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map(
      ([, name]) => name,
    );
    assert.deepEqual([...new Set(secretNames)], [
      "GITHUB_TOKEN",
      "PLATFORM_DEPLOY_SSH_PRIVATE_KEY",
      "PLATFORM_DEPLOY_SSH_KNOWN_HOSTS",
      "PLATFORM_DEPLOY_HOST",
      "PLATFORM_DEPLOY_USER",
    ]);

    const actionLines = workflow
      .split("\n")
      .filter((line) => /^\s*uses:/u.test(line));
    assert.ok(actionLines.length > 0);
    assert.ok(
      actionLines.every((line) => /@[a-f0-9]{40}\s+#\s+v\d+\.\d+\.\d+$/u.test(line.trim())),
    );
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
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
