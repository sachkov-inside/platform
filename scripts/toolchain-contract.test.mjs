// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { z } from "zod";

import { readPackageManifest } from "./package-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
// The tsconfig and lint fields the contracts below compare; the rest passes through.
const tsconfigSchema = z
  .object({
    extends: z.unknown().optional(),
    compilerOptions: z.record(z.string(), z.unknown()).optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    references: z
      .array(z.object({ path: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();
const oxlintConfigSchema = z
  .object({
    ignorePatterns: z.array(z.string()).optional(),
    overrides: z.array(
      z
        .object({
          files: z.array(z.string()),
          rules: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
/**
 * @typedef {z.infer<typeof tsconfigSchema>} TsConfig
 * @typedef {z.infer<typeof oxlintConfigSchema>} OxlintConfig
 * @typedef {OxlintConfig["overrides"][number]} OxlintOverride
 */
/** @param {string} path */
const readTsconfig = (path) => tsconfigSchema.parse(JSON.parse(read(path)));
const scriptsTsconfig = readTsconfig("tsconfig.scripts.json");
/** @param {string} path */
const readManifest = (path) =>
  readPackageManifest(resolve(repositoryRoot, path));
const rootPackage = readManifest("package.json");
const backendPackage = readManifest("apps/backend/package.json");
const webPackage = readManifest("apps/web/package.json");
const telegramPackage = readManifest("apps/telegram/package.json");
const nodeVersion = read(".node-version").trim();
const pnpmVersion = (rootPackage.packageManager ?? "").replace(/^pnpm@/u, "");
const applicationDockerfiles = [
  "apps/backend/Dockerfile",
  "apps/web/Dockerfile",
  "apps/telegram/infra/production/Dockerfile",
];

describe("supported toolchain contract", () => {
  it("keeps Docker on the repository Node and pnpm pins", () => {
    for (const path of applicationDockerfiles) {
      const dockerfile = read(path);

      assert.match(
        dockerfile,
        new RegExp(
          `^FROM public\\.ecr\\.aws/docker/library/node:${escapeRegExp(nodeVersion)}-(?:alpine\\d+\\.\\d+|bookworm-slim)@sha256:[a-f0-9]{64} AS toolchain$`,
          "mu",
        ),
      );
      assertNodeBasesPinnedByDigest(path, dockerfile);
      assert.match(
        dockerfile,
        /npm install --global corepack@\d+\.\d+\.\d+(?:\s|$)/u,
      );
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
        "patches ./patches",
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

  it("shares the complete cacheable dependency ancestry between backend and Web", () => {
    const dependencyAncestry = (/** @type {string} */ dockerfile) =>
      dockerfile
        .split("FROM dependencies AS development")[0]
        ?.replace(/\\\n\s*/gu, " ")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
    // Compare base, environment, user, workdir, every COPY and the install/cache-mount command.
    // Matching pnpm text alone cannot reuse a snapshot with different inherited environment.
    assert.deepEqual(
      dependencyAncestry(read("apps/web/Dockerfile")),
      dependencyAncestry(read("apps/backend/Dockerfile")),
      "Both builds must submit the same dependency ancestry to BuildKit",
    );
    const stages = read("apps/web/Dockerfile").split(/^FROM /mu);
    const development = stages.find((stage) =>
      stage.startsWith("dependencies AS development\n"),
    );
    assert.ok(development);
    assert.match(development, /^ENV NEXT_TELEMETRY_DISABLED=1$/mu);
    for (const target of ["web", "storybook", "production-build"]) {
      assert.ok(
        stages.some((stage) => stage.startsWith(`development AS ${target}\n`)),
      );
    }
    const production = stages.find((stage) =>
      stage.includes(" AS web-production\n"),
    );
    assert.ok(production);
    assert.match(production, /^ENV NODE_ENV=production \\$/mu);
    // The standalone production target starts from a fresh base, as before this change.
    assert.doesNotMatch(production, /NEXT_TELEMETRY_DISABLED/u);
  });

  it("runs development Web from the backend workspace without a second build", () => {
    const localCompose = read("compose.yaml");
    const web = localCompose.match(
      /^ {2}web:\n(?<body>[\s\S]*?)(?=^ {2}\S|^volumes:)/mu,
    )?.groups?.["body"];
    assert.ok(web);
    assert.match(
      web,
      /^ {4}image: \$\{COMPOSE_PROJECT_NAME:-inside-platform\}-backend-development:local$/mu,
    );
    assert.doesNotMatch(web, /^ {4}build:/mu);
    assert.match(web, /^ {4}pull_policy: never$/mu);
    const command = web.match(/command:\s*(\[[\s\S]*?\])/u)?.[1];
    assert.ok(command);
    assert.deepEqual(
      z.array(z.string()).parse(JSON.parse(command.replace(/,\s*\]/u, "]"))),
      [
        "pnpm",
        "--filter",
        "@inside/web",
        "dev",
        "--hostname",
        "0.0.0.0",
        "--port",
        "3000",
      ],
    );
    assert.match(
      read("config/compose/local/web.env"),
      /^NEXT_TELEMETRY_DISABLED=1$/mu,
    );
  });

  it("builds production Web under a separate image and production command", () => {
    const web = read("config/compose/local/production-web.compose.yaml").match(
      /^ {2}web:\n(?<body>[\s\S]*)$/mu,
    )?.groups?.["body"];
    assert.ok(web);
    assert.match(
      web,
      /^ {4}image: \$\{COMPOSE_PROJECT_NAME:-inside-platform\}-web-production:local$/mu,
    );
    assert.match(web, /^ {6}context: \.$/mu);
    assert.match(web, /^ {6}dockerfile: apps\/web\/Dockerfile$/mu);
    assert.match(web, /^ {6}target: web-production$/mu);
    assert.match(web, /command: \["node", "apps\/web\/server\.js"\]/u);
    assert.match(web, /INSIDE_SOURCE_SHA: \$\{STAND_WEB_SOURCE_SHA:\?/u);
    assert.match(
      web,
      /CSP_LOCAL_OBJECT_STORAGE_ORIGIN: \$\{STAND_WEB_OBJECT_STORAGE_ORIGIN:\?/u,
    );
  });

  it("keeps TypeScript exact and Node declarations on the runtime major", () => {
    const nodeMajor = nodeVersion.split(".")[0];
    const packages = [rootPackage, backendPackage, webPackage, telegramPackage];
    const typeScriptPins = packages.map(
      (manifest) => manifest.devDependencies["typescript"],
    );

    assert.equal(new Set(typeScriptPins).size, 1);
    assert.equal(typeScriptPins[0], "7.0.2");
    assert.ok(
      typeScriptPins.every(
        (version) => version !== undefined && /^\d+\.\d+\.\d+$/u.test(version),
      ),
    );
    for (const manifest of [
      rootPackage,
      backendPackage,
      webPackage,
      telegramPackage,
    ]) {
      assert.equal(
        manifest.devDependencies["@types/node"]?.split(".")[0],
        nodeMajor,
      );
    }
  });

  it("keeps editors, Next and CLI checks on TypeScript 7 projects", () => {
    const editorSettings = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(read(".vscode/settings.json")));
    const { include: backendInclude = [] } = readTsconfig(
      "apps/backend/tsconfig.json",
    );
    const { include: webInclude = [], exclude: webExclude = [] } = readTsconfig(
      "apps/web/tsconfig.json",
    );
    const nextTypeScript = readTsconfig("apps/web/tsconfig.next.json");
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
      compilerOptionsOf("apps/backend/tsconfig.json")["experimentalDecorators"],
      true,
    );
    assert.ok(backendInclude.includes("src/**/*.ts"));
    assert.ok(webInclude.includes(".next/types/**/*.ts"));
    assert.ok(!webInclude.includes(".next/dev/types/**/*.ts"));
    assert.ok(webExclude.includes(".next/dev"));
    assert.equal(nextTypeScript.extends, "./tsconfig.json");
    assert.ok(
      (nextTypeScript.include ?? []).includes(".next/dev/types/**/*.ts"),
    );
    assert.doesNotMatch(nextConfig, /useTypeScriptCli:\s*false/u);
    assert.match(nextConfig, /tsconfigPath: "tsconfig\.next\.json"/u);
  });

  it("hides the development indicator where the course bars are used", () => {
    // Сторожит звенья проводки: убери любое — и перекрытие нижних панелей курса индикатором
    // вернётся молча, одними лишь плавающими промахами. Причину и выбор держит
    // `apps/web/next.config.ts`; без переменной индикатор стоит внизу слева.
    const nextConfig = read("apps/web/next.config.ts");

    assert.match(
      nextConfig,
      /process\.env\["HIDE_DEV_INDICATOR"\] === "true"/u,
    );
    assert.match(nextConfig, /devIndicators: hideDevIndicator \? false/u);
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
      compilerOptionsOf("tsconfig.node-lib.json")["erasableSyntaxOnly"],
      true,
    );
    assert.equal(
      compilerOptionsOf("tsconfig.node-lib.json")["isolatedDeclarations"],
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
      rootPackage.scripts["lint"],
      "oxlint --deny-warnings --report-unused-disable-directives --ignore-pattern 'apps/backend/test/guardrails/fixtures/oxlint/**' .",
    );
    assert.equal(rootPackage.devDependencies["oxlint"], "1.86.0");
    assert.equal(rootPackage.devDependencies["oxlint-tsgolint"], "7.0.2003");
    assert.equal(rootPackage.devDependencies["oxc-parser"], "0.152.0");

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
    const config = oxlintConfigSchema.parse(JSON.parse(read(".oxlintrc.json")));
    assert.deepEqual(strictLintViolations(config), []);

    // Negative fixtures: a second type-aware copy, a package left out, a strict rule missing from
    // the shared set, and an application override that switches a strict rule off.
    const [shared] = config.overrides.filter(isTypeAwareOverride);
    assert.ok(shared);
    /** @param {OxlintOverride[]} overrides */
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
      shared.rules ?? {};
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
    // A scripts-only override outside the two script lint overrides relaxes a strict rule too.
    assert.deepEqual(
      strictLintViolations(
        withOverrides([
          ...config.overrides,
          {
            files: ["scripts/**/*.mjs"],
            rules: { "typescript/no-unsafe-type-assertion": "off" },
          },
        ]),
      ),
      [
        "scripts/**/*.mjs must not override typescript/no-unsafe-type-assertion",
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

  it("type-checks every repository script", () => {
    assert.match(
      rootPackage.scripts["typecheck"] ?? "",
      /tsc -p tsconfig\.scripts\.json/u,
    );
    const scripts = repositoryScripts();
    assert.deepEqual(scriptCheckViolations(scripts, read), []);

    // Negative fixtures: a new script without the check, one that starts with a different comment,
    // a script outside the project and a checked script that switches the check off.
    /** @type {Record<string, string>} */
    const contents = {
      "scripts/new.mjs": "export {};\n",
      "tools/authoring/commented.mjs": "// Local tool.\n// @ts-check\n",
      "scripts/typed.mjs": "#!/usr/bin/env node\n// @ts-check\n",
      "other/checked.mjs": "// @ts-check\n",
      "scripts/escaped.mjs": "// @ts-check\n// @ts-nocheck\n",
    };
    assert.deepEqual(
      scriptCheckViolations(
        Object.keys(contents),
        (path) => contents[path] ?? "",
      ),
      [
        "scripts/new.mjs must start with // @ts-check",
        "tools/authoring/commented.mjs must start with // @ts-check",
        "other/checked.mjs must be in tsconfig.scripts.json",
        "scripts/escaped.mjs must not switch its check off with @ts-nocheck",
      ],
    );
  });

  it("lints every repository script with the shared no-unsafe rules", () => {
    const config = oxlintConfigSchema.parse(JSON.parse(read(".oxlintrc.json")));
    const rootProject = readTsconfig("tsconfig.json");
    assert.deepEqual(
      scriptLintViolations(config, scriptsTsconfig, rootProject),
      [],
    );

    // Negative fixtures: a script directory left out, a rule missing from the scripts set, lint of
    // the excluded fixtures, and a root tsconfig that no longer leads to the scripts project.
    /** @param {(override: OxlintOverride) => OxlintOverride} change */
    const changed = (change) => ({
      ...config,
      overrides: config.overrides.map(change),
    });
    const scriptsInclude = scriptsTsconfig.include ?? [];
    const isScripts = (/** @type {OxlintOverride} */ override) =>
      isDeepStrictEqual(override.files, scriptsInclude);
    assert.deepEqual(
      scriptLintViolations(
        changed((override) =>
          isScripts(override)
            ? {
                ...override,
                files: override.files.filter(
                  (files) => files !== "tools/**/*.mjs",
                ),
              }
            : override,
        ),
        scriptsTsconfig,
        rootProject,
      ),
      [`script lint must have an override for ${scriptsInclude.join(", ")}`],
    );
    assert.deepEqual(
      scriptLintViolations(
        changed((override) => {
          if (!isScripts(override)) return override;
          const { "typescript/no-unsafe-member-access": _omitted, ...rules } =
            override.rules ?? {};
          return { ...override, rules };
        }),
        scriptsTsconfig,
        rootProject,
      ),
      [
        `typescript/no-unsafe-member-access must be error for ${scriptsInclude.join(", ")}`,
      ],
    );
    assert.deepEqual(
      scriptLintViolations(
        changed((override) =>
          isDeepStrictEqual(override.files, ["**/fixtures/**/*.mjs"])
            ? {
                ...override,
                rules: {
                  ...override.rules,
                  "typescript/no-unsafe-call": "error",
                },
              }
            : override,
        ),
        scriptsTsconfig,
        rootProject,
      ),
      ["typescript/no-unsafe-call must be off for **/fixtures/**/*.mjs"],
    );
    assert.deepEqual(
      scriptLintViolations(config, scriptsTsconfig, {
        ...rootProject,
        references: [],
      }),
      ["tsconfig.json must reference tsconfig.scripts.json"],
    );

    // No other override may relax a script rule, even for a single script.
    const scripts = repositoryScripts();
    assert.deepEqual(relaxedScriptLintViolations(config, scripts), []);
    assert.deepEqual(
      relaxedScriptLintViolations(
        {
          ...config,
          overrides: [
            ...config.overrides,
            {
              files: ["scripts/setup-local.mjs"],
              rules: { "typescript/no-unsafe-member-access": "off" },
            },
          ],
        },
        scripts,
      ),
      [
        "scripts/setup-local.mjs must not relax typescript/no-unsafe-member-access for scripts",
      ],
    );
    assert.deepEqual(
      relaxedScriptLintViolations(
        {
          ...config,
          ignorePatterns: [...(config.ignorePatterns ?? []), "tools/**"],
        },
        scripts,
      ),
      ["tools/** must not ignore a script"],
    );
    assert.deepEqual(
      relaxedScriptLintViolations(
        {
          ...config,
          ignorePatterns: [...(config.ignorePatterns ?? []), "authoring"],
        },
        scripts,
      ),
      ["authoring must not ignore a script"],
    );
  });

  it("keeps TypeScript-API consumers out of active Web tooling", () => {
    assert.equal(
      webPackage.devDependencies["@storybook/nextjs-vite"],
      undefined,
    );
    assert.equal(webPackage.devDependencies["@storybook/react-vite"], "10.6.1");
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

  it("keeps Storybook MCP on the compiler-free React docgen path", () => {
    assert.equal(
      webPackage.devDependencies["@storybook/addon-mcp"],
      webPackage.devDependencies["@storybook/react-vite"],
    );
    assert.match(
      read("apps/web/.storybook/main.ts"),
      /typescript:\s*\{\s*reactDocgen:\s*"react-docgen"\s*\}/u,
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
      /apps\/web\/Dockerfile: FROM public\.ecr\.aws\/docker\/library\/node:/u,
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

  it("rejects a production Node base that differs from the shared runtime", () => {
    const dockerfile = read("apps/web/Dockerfile");
    assert.throws(
      () =>
        assertNodeBasesPinnedByDigest(
          "apps/web/Dockerfile",
          dockerfile.replace(
            new RegExp(
              `FROM public\\.ecr\\.aws/docker/library/node:${escapeRegExp(nodeVersion)}-([^\\s]+) AS web-production`,
              "u",
            ),
            "FROM public.ecr.aws/docker/library/node:22.0.0-$1 AS web-production",
          ),
        ),
      /apps\/web\/Dockerfile: FROM public\.ecr\.aws\/docker\/library\/node:/u,
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
        return (
          /:[A-Za-z0-9][^\s@]*(?:@sha256:[a-f0-9]{64})?$/u.test(image) &&
          !/:latest$/u.test(image)
        );
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

    const [, workerBody] = workerBlock ?? [];
    assert.ok(workerBody, "compose.yaml must declare profile-avatars-worker");
    assert.match(workerBody, /profile-avatars-worker\.env/u);
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
    for (const [, name, body = ""] of groupBodies) {
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

/**
 * Тег читает человек, digest фиксирует базу: перевыпущенный тег не меняет следующий выпуск.
 *
 * @param {string} path
 * @param {string} dockerfile
 */
function assertNodeBasesPinnedByDigest(path, dockerfile) {
  const nodeBases =
    dockerfile.match(/^FROM public\.ecr\.aws\/docker\/library\/node:\S+/gmu) ??
    [];
  assert.ok(
    nodeBases.length > 1,
    `${path} must build its production stage from Node`,
  );
  for (const base of nodeBases) {
    assert.match(
      base,
      new RegExp(
        `^FROM public\\.ecr\\.aws/docker/library/node:${escapeRegExp(nodeVersion)}-[^\\s@]+@sha256:[a-f0-9]{64}$`,
        "u",
      ),
      `${path}: ${base}`,
    );
  }
}

const swaggerTypeScriptAllowance = `peerDependencyRules:
  allowedVersions:
    "@nestjs/swagger>typescript": "7"
`;

/**
 * The whole top-level block, so a widened rule next to the allowance cannot pass unnoticed.
 *
 * @param {string} workspace
 */
function peerDependencyRulesBlock(workspace) {
  return (
    workspace.match(/^peerDependencyRules:\n(?:(?: {2}.*)?\n)*/mu)?.[0] ?? ""
  );
}

/**
 * Nest CLI loads the plugin by package name from nest-cli.json; code loads it by its subpath.
 *
 * @param {string} path
 * @param {string} source
 */
function loadsSwaggerPlugin(path, source) {
  return (
    source.includes("@nestjs/swagger/plugin") ||
    (path.endsWith("nest-cli.json") && source.includes("@nestjs/swagger"))
  );
}

/** @param {string} workspace */
function overrideNames(workspace) {
  const [, overrides] =
    workspace.match(/^overrides:\n((?:(?: {2}.*)?\n)*)/mu) ?? [];
  return overrides === undefined
    ? []
    : [...overrides.matchAll(/^ {2}([^#\s:][^:]*):/gmu)].map(
        ([, name = ""]) => name,
      );
}

/** Files that compile with the strict application rules and so get the type-aware lint set. */
const typeAwareLintFiles = [
  "apps/backend/**/*.{ts,mts,cts}",
  "packages/**/*.{ts,mts,cts}",
  "apps/web/**/*.{ts,tsx,mts,cts}",
  "apps/telegram/**/*.{ts,mts,cts}",
];
/** Rules #694 enables everywhere; only generated code and generated migrations may relax them. */
const strictLintRules = [
  "typescript/no-unsafe-type-assertion",
  "typescript/no-unnecessary-condition",
  "typescript/prefer-optional-chain",
  "typescript/strict-boolean-expressions",
];
/**
 * Options #694 fixes for rules that take them; a weaker option is a violation too.
 *
 * @type {Record<string, unknown>}
 */
const strictLintOptions = {
  "typescript/strict-boolean-expressions": {
    allowString: false,
    allowNumber: false,
    allowNullableObject: true,
  },
};
const generatedCodeFiles =
  "apps/backend/src/infrastructure/prisma/generated/**/*.ts";

/**
 * `no-floating-promises` needs type information, so only a type-aware set declares it.
 *
 * @param {OxlintOverride} override
 */
function isTypeAwareOverride(override) {
  return "typescript/no-floating-promises" in (override.rules ?? {});
}

/** @param {OxlintConfig} config */
function strictLintViolations(config) {
  const typeAware = config.overrides.filter(isTypeAwareOverride);
  const [shared] = typeAware;
  if (typeAware.length !== 1 || shared === undefined) {
    return [`expected one type-aware override, found ${typeAware.length}`];
  }
  const violations = typeAwareLintFiles
    .filter((files) => !shared.files.includes(files))
    .map((files) => `type-aware lint must cover ${files}`);
  for (const rule of strictLintRules) {
    const setting = shared.rules?.[rule];
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
      if (
        override === shared ||
        override.files.includes(generatedCodeFiles) ||
        isScriptLintOverride(override)
      )
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
 * The script lint overrides and the `no-unsafe-*` setting each must hold: the files
 * tsconfig.scripts.json compiles, and the files it excludes.
 *
 * @param {TsConfig} scriptsProject
 * @returns {[files: string[], setting: string][]}
 */
function scriptLintOverrides(scriptsProject) {
  return [
    [scriptsProject.include ?? [], "error"],
    ...(scriptsProject.exclude ?? [])
      .filter((pattern) => pattern !== "**/node_modules/**")
      .map(
        (pattern) =>
          /** @type {[string[], string]} */ ([[`${pattern}/*.mjs`], "off"]),
      ),
  ];
}

/**
 * The script lint overrides set the scripts' own rules, which scriptLintViolations checks; any
 * other override stays under the strict-rule check.
 *
 * @param {OxlintOverride} override
 */
function isScriptLintOverride(override) {
  return scriptLintOverrides(scriptsTsconfig).some(([files]) =>
    isDeepStrictEqual(override.files, files),
  );
}

/**
 * Scripts get every `no-unsafe-*` rule of the shared type-aware set (#763). The set covers exactly
 * the files tsconfig.scripts.json compiles and is off where that project excludes files: outside a
 * program every type is an error. Type-aware lint finds that project through the root tsconfig.
 *
 * @param {OxlintConfig} config
 * @param {TsConfig} scriptsProject
 * @param {TsConfig} rootProject
 */
function scriptLintViolations(config, scriptsProject, rootProject) {
  /** @type {string[]} */
  const violations = [];
  if (
    !(rootProject.references ?? []).some(
      ({ path }) => path === "./tsconfig.scripts.json",
    )
  ) {
    violations.push("tsconfig.json must reference tsconfig.scripts.json");
  }
  const [shared] = config.overrides.filter(isTypeAwareOverride);
  const unsafeRules = Object.keys(shared?.rules ?? {}).filter((rule) =>
    rule.startsWith("typescript/no-unsafe-"),
  );
  for (const [files, setting] of scriptLintOverrides(scriptsProject)) {
    const override = config.overrides.find((candidate) =>
      isDeepStrictEqual(candidate.files, files),
    );
    if (override === undefined) {
      violations.push(
        `script lint must have an override for ${files.join(", ")}`,
      );
      continue;
    }
    for (const rule of unsafeRules) {
      if (override.rules?.[rule] !== setting) {
        violations.push(`${rule} must be ${setting} for ${files.join(", ")}`);
      }
    }
  }
  return violations;
}

/**
 * Only the script lint overrides set the scripts' `no-unsafe-*` rules; another override that
 * matches a script must not weaken one, and no ignore pattern may drop a script from lint.
 *
 * @param {OxlintConfig} config
 * @param {string[]} scripts
 */
function relaxedScriptLintViolations(config, scripts) {
  /** @type {string[]} */
  const violations = (config.ignorePatterns ?? [])
    .filter((pattern) => scripts.some((path) => ignoresPath(pattern, path)))
    .map((pattern) => `${pattern} must not ignore a script`);
  for (const override of config.overrides) {
    if (isTypeAwareOverride(override) || isScriptLintOverride(override))
      continue;
    const matchesScript = scripts.some((path) =>
      override.files.some((files) => matchesGlob(path, files)),
    );
    if (!matchesScript) continue;
    for (const [rule, setting] of Object.entries(override.rules ?? {})) {
      if (
        rule.startsWith("typescript/no-unsafe-") &&
        (Array.isArray(setting) ? setting[0] : setting) !== "error"
      ) {
        violations.push(
          `${override.files.join(", ")} must not relax ${rule} for scripts`,
        );
      }
    }
  }
  return violations;
}

/**
 * Oxlint reads ignore patterns as `.gitignore` does: a pattern without an inner slash names a file
 * or directory at any depth, and a matched directory ignores everything below it.
 *
 * @param {string} pattern
 * @param {string} path
 */
function ignoresPath(pattern, path) {
  if (pattern.startsWith("!")) return false;
  const trimmed = pattern.replace(/\/$/u, "");
  const anchored = trimmed.replace(/^\//u, "");
  const globs = trimmed.includes("/")
    ? [anchored]
    : [anchored, `**/${anchored}`];
  return globs.some(
    (glob) => matchesGlob(path, glob) || matchesGlob(path, `${glob}/**`),
  );
}

/** Tracked repository scripts: every `.mjs` except the ones outsideScriptCheck names. */
function repositoryScripts() {
  return spawnSync("git", ["ls-files", "-z", "--", "*.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .stdout.split("\0")
    .filter((path) => path.length > 0 && !outsideScriptCheck(path));
}

/**
 * Upstream skill copies, recorded evidence and test fixtures are not repository scripts.
 *
 * @param {string} path
 */
function outsideScriptCheck(path) {
  return (
    path.startsWith(".agents/") ||
    path.startsWith("docs/evidence/") ||
    path.includes("/fixtures/")
  );
}

/**
 * Every repository script is inside tsconfig.scripts.json and checked there: it starts with
 * `// @ts-check` and never switches the check off (#694, #756).
 *
 * @param {string[]} scripts
 * @param {(path: string) => string} contentOf
 */
function scriptCheckViolations(scripts, contentOf) {
  const { include = [], exclude = [] } = scriptsTsconfig;
  /** @type {string[]} */
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
    if (!checked) {
      violations.push(`${path} must start with // @ts-check`);
    } else if (/^\s*(?:\/\/|\/\*)\s*@ts-nocheck/mu.test(contentOf(path))) {
      violations.push(`${path} must not switch its check off with @ts-nocheck`);
    }
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

/**
 * Why one tracked tsconfig breaks the shared base contract; `overrides` replaces files for fixtures.
 *
 * @param {string} path
 * @param {Record<string, TsConfig>} [overrides]
 */
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
  const own = (overrides[path] ?? readTsconfig(path)).compilerOptions ?? {};
  return Object.keys(sharedStrictness)
    .filter((flag) => flag in own)
    .map((flag) => `${path} must not override ${flag}`);
}

/**
 * Repository-relative configs a project inherits, nearest first; `overrides` replaces files for
 * fixtures.
 *
 * @param {string} path
 * @param {Record<string, TsConfig>} [overrides]
 */
function extendsChain(path, overrides = {}) {
  /** @type {string[]} */
  const chain = [];
  /** @type {string | undefined} */
  let current = path;
  while (current !== undefined) {
    chain.push(current);
    /** @type {TsConfig} */
    const config = overrides[current] ?? readTsconfig(current);
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

/** @param {string} path */
function compilerOptionsOf(path) {
  /** @type {Record<string, unknown>} */
  const options = {};
  for (const config of extendsChain(path).reverse())
    Object.assign(options, readTsconfig(config).compilerOptions ?? {});
  return options;
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
