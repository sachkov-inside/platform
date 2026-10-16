import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";
import { commandExit } from "../../../../scripts/diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "../../../../scripts/owned-process.mjs";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const eventSchema = z.object({
  kind: z.string(),
  url: z.string().optional(),
  status: z.number().optional(),
  body: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  bodyBytes: z.number().optional(),
  truncated: z.boolean().optional(),
});

for (const mode of [
  "http-setup",
  "transport",
  "http-story",
  "http-large",
  "http-unwritable",
  "success",
]) {
  it(`retains primary import evidence and the runner outcome: ${mode}`, async ({
    onTestFinished,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "inside-import-proof-"));
    const owned: { child?: ReturnType<typeof spawnOwned> } = {};
    onTestFinished(async () => {
      try {
        if (owned.child !== undefined) await stopOwned(owned.child);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    const outputDirectory =
      mode === "http-unwritable" ? join(directory, "occupied") : directory;
    if (mode === "http-unwritable")
      await writeFile(outputDirectory, "occupied");
    const child = (owned.child = spawnOwned(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "test/fixtures/storybook-import-diagnostics/vitest.config.mts",
      ],
      {
        cwd: webRoot,
        env: {
          ...process.env,
          INSIDE_IMPORT_PROBE_MODE: mode,
          INSIDE_IMPORT_PROBE_OUTPUT: outputDirectory,
        },
        timeout: 20000,
      },
    ));
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exit = await commandExit(child);
    expect(exit, output).toBe(mode === "success" ? 0 : 1);
    if (mode === "http-unwritable") {
      expect(output).toContain(
        "[storybook-imports] Could not retain diagnostics:",
      );
      return;
    }
    const files = await readdir(directory, { recursive: true });
    const reports = files.filter((file) => file.endsWith(".jsonl"));
    if (mode === "success") {
      expect(output).toContain("1 passed");
      expect(reports).toEqual([]);
      return;
    }
    expect(output).toContain("Failed to fetch dynamically imported module");
    expect(output).toContain(
      `Failed to import test file ${join(webRoot, "test/fixtures/storybook-import-diagnostics", mode === "http-story" ? "probe.test.ts" : "setup.ts")}`,
    );
    expect(reports, output).toHaveLength(1);
    const report = await readFile(
      join(directory, reports[0] ?? "missing"),
      "utf8",
    );
    expect(Buffer.byteLength(report)).toBeLessThanOrEqual(1024 * 1024);
    const events = report
      .trim()
      .split("\n")
      .map((line) => eventSchema.parse(JSON.parse(line)));
    if (mode === "http-large") {
      const body = events.find((event) => event.kind === "http-body");
      expect(body?.truncated).toBe(true);
      expect(body?.bodyBytes).toBeGreaterThan(65536);
      expect(Buffer.byteLength(body?.body ?? "")).toBeLessThanOrEqual(65536);
    }
    if (mode === "transport") {
      expect(
        events.some(
          (event) =>
            event.kind === "transport-failure" &&
            (event.url?.includes("setup-dependency.ts") ?? false) &&
            (event.error?.includes("net::") ?? false),
        ),
      ).toBe(true);
      expect(events.some((event) => event.kind === "http-response")).toBe(
        false,
      );
    } else {
      const target =
        mode === "http-story" ? "story-dependency.ts" : "setup-dependency.ts";
      expect(
        events.some(
          (event) =>
            event.kind === "http-response" &&
            (event.url?.includes(target) ?? false) &&
            event.status === 500,
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.kind === "http-body" &&
            (event.body?.includes("controlled-vite-transform-failure") ??
              false),
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.kind === "server-error" &&
            (event.message?.includes("controlled-vite-transform-failure") ??
              false),
        ),
      ).toBe(true);
    }
  }, 30000);
}
