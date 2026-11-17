import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

function isRunning(pid: number): boolean {
  const response = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
    encoding: "utf8",
  });
  if (response.error !== undefined) throw response.error;
  const state = response.stdout.trim();
  if (response.status === 1 && state === "") return false;
  if (response.status !== 0)
    throw new Error("Could not read owned engine process state");
  return state !== "" && !state.startsWith("Z");
}

for (const ending of ["SDK deadline", "shutdown while starting"] as const) {
  test(`the owned fixture terminates its never-ready engine before ${ending} cleanup returns`, async ({
    onTestFinished,
  }) => {
    const creating = mkdtemp(join(tmpdir(), "inside-owned-browser-fixture-"));
    const cleanup: { fixture?: ReturnType<typeof createOwnedBrowserFixture> } =
      {};
    onTestFinished(async () => {
      try {
        await cleanup.fixture?.close();
      } finally {
        const directory = await creating.catch(() => undefined);
        if (directory !== undefined)
          await rm(directory, { recursive: true, force: true });
      }
    });
    const directory = await creating;
    const marker = join(directory, "engine.pid");
    const executable = join(directory, "never-ready-browser.sh");
    await writeFile(
      executable,
      `#!/bin/sh\ntrap '' TERM\nprintf '%s' "$$" > '${marker}.tmp'\nmv '${marker}.tmp' '${marker}'\nexec /bin/sleep 600\n`,
      { mode: 0o700 },
    );
    const fixture = createOwnedBrowserFixture("term-deck", {
      startupTimeoutMs: 20_000,
      browserLaunchTimeoutMs: ending === "SDK deadline" ? 1_000 : 30_000,
      browserExecutablePath: executable,
    });
    cleanup.fixture = fixture;
    const outcome = fixture.start().catch((error: unknown) => error);
    if (ending === "SDK deadline") {
      const failure = await outcome;
      expect(failure).toBeInstanceOf(Error);
      if (failure instanceof Error)
        expect(failure.message).toContain("Timeout 1000ms exceeded");
      expect(existsSync(marker)).toBe(true);
    } else {
      await expect
        .poll(() => existsSync(marker), { timeout: 20_000 })
        .toBe(true);
    }
    const original = await readFile(marker, "utf8");
    const pid = z.coerce.number().int().positive().parse(original);
    await fixture.close();
    await expect(outcome).resolves.toBeInstanceOf(Error);
    expect(isRunning(pid)).toBe(false);
    await expect(fixture.start()).rejects.toThrow("Browser fixture is closed");
    expect(await readFile(marker, "utf8")).toBe(original);
    expect(isRunning(pid)).toBe(false);
  }, 30_000);
}
