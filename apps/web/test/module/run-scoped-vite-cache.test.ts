// deterministic-test-allow unit-io: Local runner process/cache contract; suite separation is tracked in #1154.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig, type Plugin } from "vite";

import { runScopedViteCache } from "../support/run-scoped-vite-cache.mjs";
import vitestConfig from "../../vitest.config.mjs";

// Без подмены import конфигурации запускает `storybookTest`: тот грузит presets Storybook и
// меняет окружение процесса проверок.
vi.mock("@storybook/addon-vitest/vitest-plugin", () => ({
  storybookTest: () => [],
}));

const helper = new URL("../support/run-scoped-vite-cache.mjs", import.meta.url);
const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Как `storybookTest`: общий для всех запусков checkout каталог кеша. */
function sharedStorybookCache(cacheDir: string): Plugin {
  return { name: "shared-storybook-cache", config: () => ({ cacheDir }) };
}

async function resolvedCacheDir(plugins: Plugin[]): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "inside-vite-root-"));
  created.push(root);
  const config = await resolveConfig(
    { configFile: false, logLevel: "silent", root, plugins },
    "serve",
  );
  created.push(config.cacheDir);
  return config.cacheDir;
}

describe("run-scoped Vite cache for Storybook runners (#1004)", () => {
  it("replaces the shared Storybook cache with a directory of its own", async () => {
    const shared = path.join(tmpdir(), "inside-shared-sb-vitest");

    const cacheDir = await resolvedCacheDir([
      runScopedViteCache(),
      sharedStorybookCache(shared),
    ]);

    expect(cacheDir).not.toBe(shared);
    expect(existsSync(cacheDir)).toBe(true);
  });

  it("gives two runners two different directories", async () => {
    const shared = path.join(tmpdir(), "inside-shared-sb-vitest");

    const first = await resolvedCacheDir([
      sharedStorybookCache(shared),
      runScopedViteCache(),
    ]);
    const second = await resolvedCacheDir([
      sharedStorybookCache(shared),
      runScopedViteCache(),
    ]);

    expect(first).not.toBe(second);
  });

  it("removes its directory when the runner process exits", () => {
    const cacheDir = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { runScopedViteCache } = await import(${JSON.stringify(helper.href)});
         process.stdout.write(runScopedViteCache().config().cacheDir);`,
      ],
      { encoding: "utf8" },
    );
    created.push(cacheDir);

    expect(cacheDir).toContain("inside-vitest-deps-");
    expect(existsSync(cacheDir)).toBe(false);
  });

  it("runs in the Storybook project of the Vitest config", () => {
    const storybook = vitestConfig.test?.projects?.find(
      (project) =>
        typeof project === "object" &&
        "test" in project &&
        project.test.name === "storybook",
    );
    const plugins =
      typeof storybook === "object" && "plugins" in storybook
        ? (storybook.plugins ?? [])
        : [];

    expect(
      plugins.some(
        (plugin) =>
          typeof plugin === "object" &&
          plugin !== null &&
          "name" in plugin &&
          plugin.name === "inside:run-scoped-vite-cache",
      ),
    ).toBe(true);
  });
});
