// @ts-check
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  globSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { readPackageManifest } from "./package-manifest.mjs";
import {
  normalizePlaywright,
  normalizeVitest,
} from "./nightly-flake-report.mjs";

/** @typedef {{name: string, directory: string, engine: "vitest" | "playwright" | "node", args: string[]}} Command */
const root = resolve(import.meta.dirname, "..");
/** @param {string} name @param {string} directory @param {string} [script] @returns {Command} */
function vitest(name, directory, script = "test") {
  return {
    name,
    directory,
    engine: "vitest",
    args: ["run", script],
  };
}

/** Unit inventory follows the same workspace manifests as recursive --if-present test.
 * @returns {Command[]}
 */
function workspaceUnitCommands() {
  const packages = z
    .array(z.object({ name: z.string(), path: z.string() }))
    .parse(
      JSON.parse(
        execFileSync(
          "pnpm",
          ["list", "--recursive", "--depth", "-1", "--json"],
          { cwd: root, encoding: "utf8" },
        ),
      ),
    );
  return packages.flatMap((pkg) => {
    if (pkg.name === "@inside/platform" || pkg.name === "@inside/web")
      return [];
    const script = readPackageManifest(resolve(pkg.path, "package.json"))
      .scripts["test"];
    if (script === undefined) return [];
    if (!script.startsWith("vitest run"))
      throw new Error(
        `Add a flake reporter adapter for ${pkg.name}: ${script}`,
      );
    return [vitest(pkg.name.split("/").at(-1) ?? pkg.name, pkg.path)];
  });
}

/** Root Node test scripts own both the launcher and file patterns.
 * Complex new shell syntax needs an explicit adapter instead of silently skipping tests.
 * @param {string} script @returns {Command[]}
 */
function rootNodeCommands(script) {
  const source = readPackageManifest(resolve(root, "package.json")).scripts[
    script
  ];
  if (source === undefined)
    throw new Error(`Missing root test script: ${script}`);
  return source.split(" && ").map((command, index) => {
    const [executable, ...tokens] = command.split(/\s+/u);
    if (
      executable !== "node" ||
      !tokens.includes("--test") ||
      tokens.some((token) => /["'$;|&]/u.test(token))
    )
      throw new Error(`Unsupported Node test command: ${command}`);
    return {
      name: `${script.replace("test:", "")}${index === 0 ? "" : `-${index + 1}`}`,
      directory: ".",
      engine: "node",
      args: tokens.flatMap((token) =>
        token.includes("*") ? globSync(token, { cwd: root }) : [token],
      ),
    };
  });
}

/** @returns {Command[]} */
function unitCommands() {
  const aggregate = readPackageManifest(resolve(root, "package.json")).scripts[
    "check:unit"
  ];
  if (aggregate === undefined) throw new Error("Missing check:unit script");
  return aggregate.split(" && ").flatMap((command) => {
    const rootScript = /^pnpm (test:[\w-]+)$/u.exec(command)?.[1];
    if (rootScript !== undefined) return rootNodeCommands(rootScript);
    if (
      command === "pnpm --recursive --if-present --filter '!@inside/web' test"
    )
      return workspaceUnitCommands();
    const webScript = /^pnpm --filter @inside\/web (test:[\w-]+)$/u.exec(
      command,
    )?.[1];
    if (webScript !== undefined)
      return [vitest(webScript.replace("test:", ""), "apps/web", webScript)];
    throw new Error(`Unsupported check:unit stage: ${command}`);
  });
}
/** @param {string} suite @returns {Command[]} */
export function planSuite(suite) {
  switch (suite) {
    case "web-e2e":
      return [
        {
          name: "e2e",
          directory: "apps/web",
          engine: "playwright",
          args: ["run", "test:e2e"],
        },
        {
          name: "navigation",
          directory: "apps/web",
          engine: "playwright",
          args: ["run", "test:navigation"],
        },
      ];
    case "storybook":
      return [vitest("storybook", "apps/web", "test:storybook")];
    case "browser-engines":
      return [vitest("browser-engines", "apps/web", "test:browser-engines")];
    case "integration":
      return [
        vitest("integration", "apps/backend", "test:integration:parallel"),
        vitest("integration-serial", "apps/backend", "test:integration:serial"),
      ];
    case "unit":
      return unitCommands();
    case "fixture":
      return [
        {
          name: "fixture",
          directory: ".",
          engine: "node",
          args: [
            "--test",
            "scripts/fixtures/nightly-flake/alternating.test.mjs",
          ],
        },
      ];
    default:
      throw new Error(`Unknown flake suite: ${suite}`);
  }
}

/** @param {string} suite @param {string} output */
export function runSuite(suite, output) {
  const plan = planSuite(suite);
  let failed = false;
  for (let iteration = 1; iteration <= 5; iteration += 1)
    for (const command of plan) {
      const directory = resolve(output, command.name, String(iteration));
      mkdirSync(directory, { recursive: true });
      const raw = resolve(directory, "raw.json");
      const log = openSync(resolve(directory, "run.log"), "w");
      /** @type {NodeJS.ProcessEnv} */
      const env = {
        ...process.env,
        FLAKE_ITERATION: String(iteration),
        PRODUCTION_WEB_SKIP_BUILD: "1",
      };
      delete env["NODE_TEST_CONTEXT"];
      let args = command.args;
      if (command.engine === "vitest")
        args = [
          ...args,
          "--retry=0",
          "--reporter=default",
          "--reporter=json",
          `--outputFile=${raw}`,
        ];
      if (suite === "storybook")
        args = [...args, "--browser.trace=retain-on-failure"];
      if (command.engine === "playwright") {
        args = [
          ...args,
          "--retries=0",
          "--reporter=list,json,html",
          `--output=${directory}/test-results`,
          "--trace=retain-on-failure",
        ];
        Object.assign(env, {
          PLAYWRIGHT_JSON_OUTPUT_NAME: raw,
          PLAYWRIGHT_HTML_OUTPUT_DIR: `${directory}/playwright-report`,
        });
      }
      if (command.engine === "node") {
        const index = args.indexOf("--test");
        args = [
          ...args.slice(0, index + 1),
          `--test-reporter=${root}/scripts/nightly-node-reporter.mjs`,
          `--test-reporter-destination=${raw}`,
          "--test-reporter=spec",
          "--test-reporter-destination=stdout",
          ...args.slice(index + 1),
        ];
      }
      console.log(`Flake hunt ${suite}/${command.name} ${iteration}/5`);
      const result = spawnSync(
        command.engine === "node" ? process.execPath : "pnpm",
        args,
        {
          cwd: resolve(root, command.directory),
          env,
          stdio: ["ignore", log, log],
        },
      );
      closeSync(log);
      if (result.status !== 0) failed = true;
      writeFileSync(
        resolve(directory, "exit.json"),
        JSON.stringify({
          status: result.status,
          signal: result.signal,
          error: result.error?.message,
        }),
      );
      try {
        const input = /** @type {unknown} */ (
          JSON.parse(readFileSync(raw, "utf8"))
        );
        const observations =
          command.engine === "playwright"
            ? normalizePlaywright(input, root, suite)
            : normalizeVitest(input, root, suite);
        for (const row of observations)
          row.project = [command.name, row.project]
            .filter((part) => part.length > 0)
            .join("/");
        writeFileSync(
          resolve(directory, "sample.observations.json"),
          JSON.stringify(observations),
        );
      } catch (error) {
        failed = true;
        writeFileSync(resolve(directory, "report-error.txt"), String(error));
      }
      // browser-engines manages its own diagnostics; preserve them before the next invocation.
      if (suite === "browser-engines" && result.status !== 0) {
        const copied = spawnSync("cp", [
          "-R",
          resolve(root, "apps/web/test-results/browser-engines"),
          resolve(directory, "browser-engines"),
        ]);
        if (copied.status !== 0)
          console.error(
            "No browser-engine diagnostic directory; inspect run.log",
          );
      }
      if (suite === "storybook") {
        for (const path of globSync(
          ["apps/web/src/**/__traces__", "apps/web/src/**/__screenshots__"],
          { cwd: root },
        )) {
          cpSync(
            resolve(root, path),
            resolve(directory, "browser-diagnostics", path),
            { recursive: true },
          );
          if (path.endsWith("/__traces__"))
            rmSync(resolve(root, path), { recursive: true, force: true });
        }
      }
    }
  return failed ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const args = z.tuple([z.string(), z.string()]).parse(process.argv.slice(2));
  process.exitCode = runSuite(args[0], resolve(args[1]));
}
