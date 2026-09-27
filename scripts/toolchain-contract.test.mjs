import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const rootPackage = JSON.parse(read("package.json"));
const backendPackage = JSON.parse(read("apps/backend/package.json"));
const webPackage = JSON.parse(read("apps/web/package.json"));
const nodeVersion = read(".node-version").trim();
const pnpmVersion = rootPackage.packageManager.replace(/^pnpm@/u, "");
const applicationDockerfiles = [
  "apps/backend/Dockerfile",
  "apps/web/Dockerfile",
];

describe("supported toolchain contract", () => {
  it("keeps Docker on the repository Node and pnpm pins", () => {
    for (const path of applicationDockerfiles) {
      const dockerfile = read(path);

      assert.match(
        dockerfile,
        new RegExp(
          `^FROM node:${escapeRegExp(nodeVersion)}-alpine\\d+\\.\\d+@sha256:[a-f0-9]{64} AS toolchain$`,
          "mu",
        ),
      );
      assertNodeBasesPinnedByDigest(path, dockerfile);
      assert.match(
        dockerfile,
        new RegExp(
          `corepack install --global pnpm@${escapeRegExp(pnpmVersion)}(?:\\s|$)`,
          "u",
        ),
      );
    }
  });

  it("copies Prisma generation and package build inputs before dependency postinstall", () => {
    for (const path of applicationDockerfiles) {
      const dockerfile = read(path);
      const installPosition = dockerfile.indexOf(
        "pnpm install --frozen-lockfile",
      );

      assert.ok(installPosition > 0);
      // Package postinstall compiles through tsconfig.node-lib.json, which extends the shared base.
      for (const input of [
        "apps/backend/prisma.config.ts",
        "apps/backend/prisma ./apps/backend/prisma",
        "tsconfig.base.json",
        "tsconfig.node-lib.json",
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
    const typeScriptPins = packages.map(
      (manifest) => manifest.devDependencies.typescript,
    );

    assert.equal(new Set(typeScriptPins).size, 1);
    assert.equal(typeScriptPins[0], "7.0.2");
    assert.ok(
      typeScriptPins.every((version) => /^\d+\.\d+\.\d+$/u.test(version)),
    );
    for (const manifest of [rootPackage, backendPackage, webPackage]) {
      assert.equal(
        manifest.devDependencies["@types/node"].split(".")[0],
        nodeMajor,
      );
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
      compilerOptionsOf("apps/backend/tsconfig.json").experimentalDecorators,
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

  it("hides the development indicator where the mobile dock is used", () => {
    // Сторожит звенья проводки: убери любое — и перекрытие дока индикатором вернётся молча,
    // одними лишь плавающими промахами. Причину и выбор держит `apps/web/next.config.ts`.
    const nextConfig = read("apps/web/next.config.ts");

    assert.match(
      nextConfig,
      /process\.env\["HIDE_DEV_INDICATOR"\] === "true"/u,
    );
    assert.match(nextConfig, /devIndicators: false/u);
    // Browser checks of `pnpm test:e2e` run on the production build, which has no indicator.
    assert.match(
      read("apps/web/playwright.config.ts"),
      /command: "node test\/support\/production-web\.mjs"/u,
    );
    assert.match(
      read("config/compose/local/web.env"),
      /^HIDE_DEV_INDICATOR=true$/mu,
    );
  });

  it("builds every TypeScript project on the shared strict base", () => {
    const listed = spawnSync(
      "git",
      ["ls-files", "-z", "--", "*tsconfig*.json"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(listed.status, 0, listed.stderr);
    const configs = listed.stdout.split("\0").filter((path) => path !== "");
    assert.ok(configs.length >= 14);
    assert.deepEqual(
      configs.flatMap((path) => sharedBaseViolations(path)),
      [],
    );
    for (const [flag, value] of Object.entries(sharedStrictness)) {
      assert.equal(compilerOptionsOf("tsconfig.base.json")[flag], value, flag);
    }
    assert.equal(
      compilerOptionsOf("tsconfig.node-lib.json").erasableSyntaxOnly,
      true,
    );
    assert.equal(
      compilerOptionsOf("tsconfig.node-lib.json").isolatedDeclarations,
      true,
    );

    // Negative fixtures: a project with its own flags, a package on an application preset, and a
    // project that switches off a shared flag.
    assert.deepEqual(
      sharedBaseViolations("apps/backend/tsconfig.json", {
        "apps/backend/tsconfig.json": { compilerOptions: { strict: true } },
      }),
      ["apps/backend/tsconfig.json must extend tsconfig.base.json"],
    );
    assert.deepEqual(
      sharedBaseViolations("packages/legal/tsconfig.json", {
        "packages/legal/tsconfig.json": {
          extends: "../../tsconfig.nest-app.json",
        },
      }),
      ["packages/legal/tsconfig.json must use tsconfig.node-lib.json"],
    );
    assert.deepEqual(
      sharedBaseViolations("apps/web/tsconfig.json", {
        "apps/web/tsconfig.json": {
          extends: "../../tsconfig.next-app.json",
          compilerOptions: { noUnusedLocals: false },
        },
      }),
      ["apps/web/tsconfig.json must not override noUnusedLocals"],
    );
  });

  it("uses only the Oxc lint and parser toolchain", () => {
    assert.equal(
      rootPackage.scripts.lint,
      "oxlint --deny-warnings --report-unused-disable-directives --ignore-pattern 'apps/backend/test/guardrails/fixtures/oxlint/**' .",
    );
    assert.equal(rootPackage.devDependencies.oxlint, "1.85.0");
    assert.equal(rootPackage.devDependencies["oxlint-tsgolint"], "7.0.2002");
    assert.equal(rootPackage.devDependencies["oxc-parser"], "0.151.0");

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

  it("keeps one strict type-aware lint set for backend, web and packages", () => {
    const config = JSON.parse(read(".oxlintrc.json"));
    assert.deepEqual(strictLintViolations(config), []);

    // Negative fixtures: a second type-aware copy, a package left out, a strict rule missing from
    // the shared set, and an application override that switches a strict rule off.
    const [shared] = config.overrides.filter(isTypeAwareOverride);
    const withOverrides = (overrides) => ({ ...config, overrides });
    assert.deepEqual(
      strictLintViolations(
        withOverrides([
          ...config.overrides,
          { ...shared, files: ["apps/web/**/*.tsx"] },
        ]),
      ),
      ["expected one type-aware override, found 2"],
    );
    assert.deepEqual(
      strictLintViolations(
        withOverrides(
          config.overrides.map((override) =>
            override === shared
              ? {
                  ...shared,
                  files: shared.files.filter(
                    (files) => !files.startsWith("packages/"),
                  ),
                }
              : override,
          ),
        ),
      ),
      ["type-aware lint must cover packages/**/*.{ts,mts,cts}"],
    );
    const { "typescript/prefer-optional-chain": _omitted, ...withoutRule } =
      shared.rules;
    assert.deepEqual(
      strictLintViolations(
        withOverrides(
          config.overrides.map((override) =>
            override === shared ? { ...shared, rules: withoutRule } : override,
          ),
        ),
      ),
      ["typescript/prefer-optional-chain must be an error in the shared set"],
    );
    assert.deepEqual(
      strictLintViolations(
        withOverrides(
          config.overrides.map((override) =>
            override === shared
              ? {
                  ...shared,
                  rules: {
                    ...shared.rules,
                    "typescript/strict-boolean-expressions": [
                      "error",
                      {
                        allowString: true,
                        allowNumber: false,
                        allowNullableObject: true,
                      },
                    ],
                  },
                }
              : override,
          ),
        ),
      ),
      ["typescript/strict-boolean-expressions must keep its #694 options"],
    );
    assert.deepEqual(
      strictLintViolations(
        withOverrides([
          ...config.overrides,
          {
            files: ["apps/web/src/**/*.tsx"],
            rules: { "typescript/no-unsafe-type-assertion": "off" },
          },
        ]),
      ),
      [
        "apps/web/src/**/*.tsx must not override typescript/no-unsafe-type-assertion",
      ],
    );
  });

  it("keeps the backend and web text helpers identical", () => {
    // Each application owns a copy so neither depends on the other; the copies must not drift.
    assert.equal(
      read("apps/web/src/shared/lib/text.ts"),
      read("apps/backend/src/infrastructure/contracts/text.ts"),
    );
  });

  it("type-checks every repository script unless it is listed as not yet typed", () => {
    assert.match(
      rootPackage.scripts.typecheck,
      /tsc -p tsconfig\.scripts\.json/u,
    );
    const scripts = spawnSync("git", ["ls-files", "-z", "--", "*.mjs"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .stdout.split("\0")
      .filter((path) => path.length > 0 && !outsideScriptCheck(path));
    assert.deepEqual(scriptCheckViolations(scripts, read), []);

    // Negative fixtures: an unchecked new script, a listed script that is typed now, a script outside
    // the project, a checked script that switches the check off and a listed script that is gone.
    const [listed] = untypedScripts;
    const contents = {
      "scripts/new.mjs": "export {};\n",
      "scripts/typed.mjs": "#!/usr/bin/env node\n// @ts-check\n",
      "other/checked.mjs": "// @ts-check\n",
      "scripts/escaped.mjs": "// @ts-check\n// @ts-nocheck\n",
      [listed]: "// @ts-check\n",
    };
    assert.deepEqual(
      scriptCheckViolations(Object.keys(contents), (path) => contents[path]),
      [
        "scripts/new.mjs must start with // @ts-check",
        "other/checked.mjs must be in tsconfig.scripts.json",
        "scripts/escaped.mjs must not switch its check off with @ts-nocheck",
        `${listed} is typed now: remove it from untypedScripts`,
        ...untypedScripts.slice(1).map((path) => `${path} no longer exists`),
      ],
    );
  });

  it("keeps TypeScript-API consumers out of active Web tooling", () => {
    assert.equal(
      webPackage.devDependencies["@storybook/nextjs-vite"],
      undefined,
    );
    assert.equal(webPackage.devDependencies["@storybook/addon-mcp"], undefined);
    assert.equal(webPackage.devDependencies["@storybook/react-vite"], "10.6.0");
    assert.equal(
      webPackage.devDependencies["openapi-typescript-codegen"],
      "0.31.0",
    );
    assert.equal(webPackage.devDependencies["openapi-typescript"], undefined);
    assert.equal(webPackage.dependencies["openapi-fetch"], undefined);
    // Только security overrides из docs/runbooks/dependency-updates.md; новый требует той же записи.
    assert.deepEqual(
      overrideNames(read("pnpm-workspace.yaml")),
      documentedSecurityOverrides,
    );
  });

  it("allows TypeScript 7 only for the unused Swagger compiler plugin", () => {
    // @nestjs/swagger imports the TypeScript API only from its CLI plugin; Platform never loads it.
    const workspace = read("pnpm-workspace.yaml");
    assert.equal(
      peerDependencyRulesBlock(workspace),
      swaggerTypeScriptAllowance,
    );
    for (const widened of [
      `  allowAny: [typescript]\n`,
      `  ignoreMissing: [typescript]\n`,
      `    storybook>typescript: "7"\n`,
    ]) {
      const rules = peerDependencyRulesBlock(
        workspace.replace(
          swaggerTypeScriptAllowance,
          `${swaggerTypeScriptAllowance}${widened}`,
        ),
      );
      assert.notEqual(rules, swaggerTypeScriptAllowance, widened);
    }

    const tracked = spawnSync(
      "git",
      ["ls-files", "-z", "--", "apps", "packages", "scripts", "*nest-cli.json"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );
    assert.equal(tracked.status, 0, tracked.stderr);
    const loaders = tracked.stdout
      .split("\0")
      .filter(
        (path) => path !== "" && path !== "scripts/toolchain-contract.test.mjs",
      )
      .filter((path) => /\.(?:[cm]?[jt]sx?|json)$/u.test(path))
      .filter((path) => loadsSwaggerPlugin(path, read(path)));
    assert.deepEqual(loaders, []);
    assert.ok(
      loadsSwaggerPlugin(
        "apps/backend/nest-cli.json",
        `{"compilerOptions":{"plugins":["@nestjs/swagger"]}}`,
      ),
    );
    assert.ok(
      loadsSwaggerPlugin(
        "apps/backend/build.mjs",
        `import { before } from "@nestjs/swagger/plugin";`,
      ),
    );
    assert.ok(
      !loadsSwaggerPlugin(
        "apps/backend/src/app.ts",
        `import { SwaggerModule } from "@nestjs/swagger";`,
      ),
    );
  });

  it("rejects a Node base pinned only by tag and an undocumented override", () => {
    const dockerfile = read("apps/web/Dockerfile");
    assert.throws(
      () =>
        assertNodeBasesPinnedByDigest(
          "apps/web/Dockerfile",
          dockerfile.replace(
            /@sha256:[a-f0-9]{64} AS web-production/u,
            " AS web-production",
          ),
        ),
      /apps\/web\/Dockerfile: FROM node:/u,
    );
    const workspace = read("pnpm-workspace.yaml");
    assert.notDeepEqual(
      overrideNames(`${workspace}  left-pad: 1.3.0\n`),
      documentedSecurityOverrides,
    );
    assert.deepEqual(
      overrideNames(workspace.replace(/^overrides:[\s\S]*$/mu, "")),
      [],
    );
  });

  it("uses explicit container version tags", () => {
    const localImageLines = read("compose.yaml")
      .split("\n")
      .filter((line) => /^\s*image:/u.test(line));
    assert.ok(localImageLines.length > 0);
    assert.ok(
      localImageLines.every((line) => {
        const image = line.trim();
        return /:[A-Za-z0-9][^\s@]*$/u.test(image) && !/:latest$/u.test(image);
      }),
    );
    assert.match(
      read("compose.production.yaml"),
      /PLATFORM_BACKEND_IMAGE_DIGEST/u,
    );
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
    ])
      assert.match(productionCompose, new RegExp(`^  ${service}:$`, "mu"));
    assert.match(productionCompose, /^networks:$/mu);
    assert.match(productionCompose, /FOUNDATION_DATABASE_NETWORK/u);
  });

  it("keeps runtime configuration in service-owned env files", () => {
    const localCompose = read("compose.yaml");
    const productionCompose = read("compose.production.yaml");

    assert.doesNotMatch(
      `${localCompose}\n${productionCompose}`,
      /^\s+environment:/mu,
    );
    assert.doesNotMatch(localCompose, /^ {2}bootstrap:/mu);
    assert.match(localCompose, /^ {2}migrations:/mu);
    assert.match(localCompose, /^ {2}seed:/mu);

    for (const path of [
      "config/compose/local/object-storage.env",
      "config/compose/local/postgres.env",
      "config/compose/local/migrations.env",
      "config/compose/local/seed.env",
      "config/compose/local/seed-checks.env",
      "config/compose/local/seed-stand.env",
      "config/compose/local/api.env",
      "config/compose/local/mcp.env",
      "config/compose/local/material-assets-worker.env",
      "config/compose/local/profile-avatars-worker.env",
      "config/compose/local/video-deletions-worker.env",
      "config/compose/local/web.env",
      "config/compose/local/storybook.env",
      "config/compose/local/bank-double.env",
      "config/compose/local/mailpit.env",
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

  it("tests object storage against the image the local stand runs", () => {
    const composeImage = read("compose.yaml").match(
      /^ {2}object-storage:\n {4}image: (\S+)$/mu,
    )?.[1];
    assert.ok(
      composeImage,
      "compose.yaml must declare the object-storage image",
    );
    assert.ok(
      composeImage.includes("@sha256:"),
      "object-storage image must be pinned by digest",
    );
    assert.ok(
      read(
        "apps/backend/test/integration/material-assets-object-storage.test.ts",
      ).includes(`"${composeImage}"`),
      "the object storage integration test must start the Compose object-storage image",
    );
  });

  it("keeps the local sale on the stand contour", () => {
    // Контур приложения не виден живым ответом: открытых endpoint с ним нет, а покупка требует
    // входа. Поэтому его держит конфигурация, и она проверяется здесь, а не смоуком стенда.
    for (const path of [
      "config/compose/local/api.env",
      "config/compose/local/billing-worker.env",
    ]) {
      const contents = read(path);
      assert.match(contents, /^TBANK_PROVIDER_MODE=test$/mu);
      assert.doesNotMatch(contents, /^TBANK_CONFIG_JSON=/mu);
      assert.match(
        contents,
        /^TBANK_TEST_API_BASE_URL=http:\/\/bank-double:8090\/v2$/mu,
      );
      assert.match(contents, /^BILLING_CONTACT_SMTP_HOST=mailpit$/mu);
      assert.match(contents, /^BILLING_CONTACT_SMTP_LOCAL_CAPTURE=true$/mu);
    }
    assert.match(
      read("config/compose/local/bank-double.env"),
      /^TBANK_PROVIDER_MODE=test$/mu,
    );
    // Перехватчик писем никуда их не пересылает: отправляющий узел ему не настроен.
    assert.doesNotMatch(
      read("config/compose/local/mailpit.env"),
      /MP_SMTP_RELAY/u,
    );
  });

  it("keeps production native dependencies and excludes development scripts", () => {
    assert.match(
      read("apps/backend/Dockerfile"),
      /deploy --prod --ignore-scripts \/workspace\/\.production\/backend/u,
    );
  });

  it("isolates production smoke resources and removes local build images", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(
      smoke,
      /project_name="inside-platform-production-smoke-\$\$"/u,
    );
    assert.match(smoke, /down --rmi local --volumes --remove-orphans/u);
    assert.match(smoke, /local test_status=\$\?/u);
    assert.match(smoke, /^PGBACKREST_ARCHIVE_ASYNC=n$/mu);
    assert.doesNotMatch(
      smoke,
      /down --rmi local --volumes --remove-orphans \|\| true/u,
    );
  });

  it("checks every worker readiness without a pipefail-sensitive grep", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.doesNotMatch(smoke, /\|\s*rg(?:\s|$)/u);
    assert.match(
      smoke,
      /^application_workers=\(material-assets-worker profile-avatars-worker video-deletions-worker billing-worker notifications-worker\)$/mu,
    );
    assert.match(
      smoke,
      /for worker in "\$\{application_workers\[@\]\}"; do\n\s+worker_state=/u,
    );
    assert.match(smoke, /running:healthy:0/u);
    assert.match(smoke, /did not report release\/schema readiness/u);
  });

  it("proves an in-flight PgBoss job completes during worker drain", () => {
    const smoke = read("scripts/production-compose-smoke.sh");

    assert.match(smoke, /wait_for_pgboss_job_state "\$drain_job_id" active/u);
    assert.match(smoke, /docker kill --signal TERM "\$old_worker_container"/u);
    assert.match(smoke, /exited before its in-flight PgBoss job could drain/u);
    assert.match(
      smoke,
      /pg_terminate_backend\(\$\{worker_drain_lock_backend_pid\}\)/u,
    );
    assert.match(
      smoke,
      /wait_for_pgboss_job_state "\$drain_job_id" completed/u,
    );
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
      /parseRuntimeIdentity\(\s*process\.env,\s*parsePlatformMode\(process\.env\["NODE_ENV"\]\)/u,
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
    const groupBodies = [
      ...dependabot.matchAll(/^\s{6}(\S+):\n((?:\s{8,}.*\n?)*)/gmu),
    ];

    assert.ok(groupBodies.length > 0);
    for (const [, name, body] of groupBodies) {
      assert.match(
        body,
        /^\s{8}update-types: \[minor, patch\]$/mu,
        `${name} can mix major updates`,
      );
    }
    // The merge queue keeps main current; automatic rebases re-ran full CI after every merge.
    const ecosystems =
      dependabot.match(/^ {2}- package-ecosystem: /gmu)?.length ?? 0;
    assert.ok(ecosystems > 0);
    assert.equal(
      dependabot.match(/^ {4}rebase-strategy: disabled$/gmu)?.length,
      ecosystems,
    );
    // Pins inside composite actions age like workflow pins; Dependabot must visit them too.
    assert.match(dependabot, /^ {6}- \/\.github\/actions\/\*$/mu);
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

const documentedSecurityOverrides = ["mysql2", "deepmerge-ts"];

/** Тег читает человек, digest фиксирует базу: перевыпущенный тег не меняет следующий выпуск. */
function assertNodeBasesPinnedByDigest(path, dockerfile) {
  const nodeBases = dockerfile.match(/^FROM node:\S+/gmu) ?? [];
  assert.ok(
    nodeBases.length > 1,
    `${path} must build its production stage from Node`,
  );
  for (const base of nodeBases) {
    assert.match(
      base,
      /^FROM node:[^\s@]+@sha256:[a-f0-9]{64}$/u,
      `${path}: ${base}`,
    );
  }
}

const swaggerTypeScriptAllowance = `peerDependencyRules:
  allowedVersions:
    "@nestjs/swagger>typescript": "7"
`;

/** The whole top-level block, so a widened rule next to the allowance cannot pass unnoticed. */
function peerDependencyRulesBlock(workspace) {
  return (
    workspace.match(/^peerDependencyRules:\n(?:(?: {2}.*)?\n)*/mu)?.[0] ?? ""
  );
}

/** Nest CLI loads the plugin by package name from nest-cli.json; code loads it by its subpath. */
function loadsSwaggerPlugin(path, source) {
  return (
    source.includes("@nestjs/swagger/plugin") ||
    (path.endsWith("nest-cli.json") && source.includes("@nestjs/swagger"))
  );
}

function overrideNames(workspace) {
  const overrides = workspace.match(/^overrides:\n((?:(?: {2}.*)?\n)*)/mu);
  return overrides === null
    ? []
    : [...overrides[1].matchAll(/^ {2}([^#\s:][^:]*):/gmu)].map(
        (match) => match[1],
      );
}

/** Files that compile with the strict application rules and so get the type-aware lint set. */
const typeAwareLintFiles = [
  "apps/backend/**/*.{ts,mts,cts}",
  "packages/**/*.{ts,mts,cts}",
  "apps/web/**/*.{ts,tsx,mts,cts}",
];
/** Rules #694 enables everywhere; only generated code and generated migrations may relax them. */
const strictLintRules = [
  "typescript/no-unsafe-type-assertion",
  "typescript/no-unnecessary-condition",
  "typescript/prefer-optional-chain",
  "typescript/strict-boolean-expressions",
];
/** Options #694 fixes for rules that take them; a weaker option is a violation too. */
const strictLintOptions = {
  "typescript/strict-boolean-expressions": {
    allowString: false,
    allowNumber: false,
    allowNullableObject: true,
  },
};
const generatedCodeFiles =
  "apps/backend/src/infrastructure/prisma/generated/**/*.ts";

/** `no-floating-promises` needs type information, so only a type-aware set declares it. */
function isTypeAwareOverride(override) {
  return "typescript/no-floating-promises" in (override.rules ?? {});
}

function strictLintViolations(config) {
  const typeAware = config.overrides.filter(isTypeAwareOverride);
  if (typeAware.length !== 1) {
    return [`expected one type-aware override, found ${typeAware.length}`];
  }
  const [shared] = typeAware;
  const violations = typeAwareLintFiles
    .filter((files) => !shared.files.includes(files))
    .map((files) => `type-aware lint must cover ${files}`);
  for (const rule of strictLintRules) {
    const setting = shared.rules[rule];
    if ((Array.isArray(setting) ? setting[0] : setting) !== "error") {
      violations.push(`${rule} must be an error in the shared set`);
    }
    if (
      rule in strictLintOptions &&
      !isDeepStrictEqual(
        Array.isArray(setting) ? setting[1] : undefined,
        strictLintOptions[rule],
      )
    ) {
      violations.push(`${rule} must keep its #694 options`);
    }
    for (const override of config.overrides) {
      if (override === shared || override.files.includes(generatedCodeFiles))
        continue;
      if (rule in (override.rules ?? {})) {
        violations.push(
          `${override.files.join(", ")} must not override ${rule}`,
        );
      }
    }
  }
  return violations;
}

/**
 * Repository `.mjs` files that are not yet typed under `tsconfig.scripts.json` (#694). A file leaves
 * this list by starting with `// @ts-check` and passing `pnpm typecheck`; a new script starts typed.
 */
const untypedScripts = [
  "apps/backend/scripts/check-backend-architecture.mjs",
  "apps/backend/scripts/generate-communications-contract.mjs",
  "apps/web/scripts/check-web-architecture.mjs",
  "apps/web/test/navigation/fake-backend.mjs",
  "packages/runtime-identity/http-healthcheck.mjs",
  "scripts/authoring-stand-gateway.mjs",
  "scripts/billing-contact-proof.mjs",
  "scripts/check-access-capabilities-boundary.mjs",
  "scripts/check-agent-documentation.mjs",
  "scripts/check-database.test.mjs",
  "scripts/communications-browser-smoke.mjs",
  "scripts/editor-local-review.mjs",
  "scripts/enrollment-browser-smoke.mjs",
  "scripts/full-stack-identity.mjs",
  "scripts/full-stack-identity.test.mjs",
  "scripts/full-stack-smoke.mjs",
  "scripts/http-healthcheck.test.mjs",
  "scripts/identity-hardening-proof.mjs",
  "scripts/identity-proof-artifacts.test.mjs",
  "scripts/identity-proof-bootstrap.mjs",
  "scripts/identity-proof-session.mjs",
  "scripts/identity-proof-start.mjs",
  "scripts/inside-deploy-gateway.test.mjs",
  "scripts/integration-serial-files.test.mjs",
  "scripts/local-stand.mjs",
  "scripts/production-deployment.test.mjs",
  "scripts/production-foundation-contract.test.mjs",
  "scripts/production-runtime-contract.test.mjs",
  "scripts/release-contract.mjs",
  "scripts/release-contract.test.mjs",
  "scripts/release-workflow-contract.test.mjs",
  "scripts/setup-local.mjs",
  "scripts/telegram-sign-in-local.mjs",
  "scripts/toolchain-contract.test.mjs",
  "scripts/tribute-local-acceptance.mjs",
  "tools/authoring/git-local.mjs",
  "tools/authoring/git-local.test.mjs",
  "tools/authoring/journal.mjs",
  "tools/authoring/local-boundaries.test.mjs",
  "tools/authoring/local-sync.mjs",
  "tools/authoring/local-sync.test.mjs",
  "tools/authoring/markdown.mjs",
  "tools/authoring/markdown.test.mjs",
  "tools/authoring/package.mjs",
  "tools/authoring/package.test.mjs",
  "tools/authoring/products.mjs",
  "tools/authoring/release.mjs",
  "tools/authoring/release.test.mjs",
  "tools/authoring/sync-completion.test.mjs",
  "tools/authoring/target.mjs",
  "tools/authoring/video.mjs",
  "tools/authoring/video.test.mjs",
];

/** Managed harness copies, recorded evidence and test fixtures are not repository scripts. */
function outsideScriptCheck(path) {
  return (
    path.startsWith(".inside-harness/") ||
    path.startsWith("docs/evidence/") ||
    path.includes("/fixtures/")
  );
}

function scriptCheckViolations(scripts, contentOf) {
  const { include, exclude } = JSON.parse(read("tsconfig.scripts.json"));
  const violations = [];
  for (const path of scripts) {
    if (
      !include.some((pattern) => matchesGlob(path, pattern)) ||
      exclude.some((pattern) => matchesGlob(path, pattern))
    ) {
      violations.push(`${path} must be in tsconfig.scripts.json`);
      continue;
    }
    const checked = /^(?:#!.*\n)?\/\/ @ts-check\n/u.test(contentOf(path));
    if (checked && /@ts-nocheck/u.test(contentOf(path))) {
      violations.push(`${path} must not switch its check off with @ts-nocheck`);
    }
    if (!checked && !untypedScripts.includes(path)) {
      violations.push(`${path} must start with // @ts-check`);
    }
    if (checked && untypedScripts.includes(path)) {
      violations.push(`${path} is typed now: remove it from untypedScripts`);
    }
  }
  for (const path of untypedScripts) {
    if (!scripts.includes(path)) violations.push(`${path} no longer exists`);
  }
  return violations;
}

const sharedStrictness = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noPropertyAccessFromIndexSignature: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedSideEffectImports: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  allowUnreachableCode: false,
  allowUnusedLabels: false,
  verbatimModuleSyntax: true,
  isolatedModules: true,
};

/** Why one tracked tsconfig breaks the shared base contract; `overrides` replaces files for fixtures. */
function sharedBaseViolations(path, overrides = {}) {
  if (path === "tsconfig.base.json") return [];
  const chain = extendsChain(path, overrides);
  if (!chain.includes("tsconfig.base.json"))
    return [`${path} must extend tsconfig.base.json`];
  if (
    path.startsWith("packages/") &&
    !chain.includes("tsconfig.node-lib.json")
  ) {
    return [`${path} must use tsconfig.node-lib.json`];
  }
  const own = (overrides[path] ?? JSON.parse(read(path))).compilerOptions ?? {};
  return Object.keys(sharedStrictness)
    .filter((flag) => flag in own)
    .map((flag) => `${path} must not override ${flag}`);
}

/** Repository-relative configs a project inherits, nearest first; `overrides` replaces files for fixtures. */
function extendsChain(path, overrides = {}) {
  const chain = [];
  for (let current = path; current !== undefined;) {
    chain.push(current);
    const config = overrides[current] ?? JSON.parse(read(current));
    current =
      typeof config.extends === "string"
        ? relative(
            repositoryRoot,
            resolve(repositoryRoot, dirname(current), config.extends),
          )
        : undefined;
  }
  return chain;
}

function compilerOptionsOf(path) {
  return Object.assign(
    {},
    ...extendsChain(path)
      .reverse()
      .map((config) => JSON.parse(read(config)).compilerOptions ?? {}),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
