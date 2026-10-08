// @ts-check
import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  globSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  normalizePlaywright,
  normalizeVitest,
} from "./nightly-flake-report.mjs";

/** @typedef {{name: string, directory: string, engine: "vitest" | "playwright" | "node", args: string[]}} Command */
const root = resolve(import.meta.dirname, "..");
/** @param {string} directory */
function nodeFiles(directory) {
  return readdirSync(resolve(root, directory))
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => `${directory}/${file}`);
}
/** @param {string} name @param {string} directory @param {string[]} args @returns {Command} */
function vitest(name, directory, args = []) {
  return {
    name,
    directory,
    engine: "vitest",
    args: ["exec", "vitest", "run", ...args],
  };
}
/** @param {string} suite @returns {Command[]} */
function commands(suite) {
  switch (suite) {
    case "web-e2e":
      return [
        {
          name: "e2e",
          directory: "apps/web",
          engine: "playwright",
          args: ["exec", "playwright", "test"],
        },
        {
          name: "navigation",
          directory: "apps/web",
          engine: "playwright",
          args: [
            "exec",
            "playwright",
            "test",
            "--config",
            "playwright.navigation.config.ts",
          ],
        },
      ];
    case "storybook":
      return [vitest("storybook", "apps/web", ["--project=storybook"])];
    case "browser-engines":
      return [
        vitest("browser-engines", "apps/web", ["--project=browser-engines"]),
      ];
    case "integration":
      return [
        vitest("integration", "apps/backend", [
          "--config",
          "vitest.integration.config.mts",
        ]),
      ];
    case "unit":
      return [
        vitest("backend", "apps/backend"),
        vitest("module", "apps/web", ["--project=module"]),
        vitest("telegram", "apps/telegram", ["--config", "vitest.config.ts"]),
        vitest("legal", "packages/legal"),
        vitest("access-capabilities", "packages/access-capabilities"),
        {
          name: "tooling",
          directory: ".",
          engine: "node",
          args: ["--test", ...nodeFiles("scripts")],
        },
        {
          name: "authoring",
          directory: ".",
          engine: "node",
          args: ["--test", ...nodeFiles("tools/authoring")],
        },
        {
          name: "practice-review",
          directory: ".",
          engine: "node",
          args: ["--test", ...nodeFiles("tools/practice-review")],
        },
        {
          name: "practice-native",
          directory: ".",
          engine: "node",
          args: [
            "apps/backend/node_modules/tsx/dist/cli.mjs",
            "--tsconfig",
            "apps/backend/tsconfig.json",
            "--test",
            ...readdirSync(resolve(root, "tools/practice-review/native"))
              .filter((file) => file.endsWith(".test.mts"))
              .map((file) => `tools/practice-review/native/${file}`),
          ],
        },
      ];
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
  const plan = commands(suite);
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
