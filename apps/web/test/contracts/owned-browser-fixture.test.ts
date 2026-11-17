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

for (const name of ["term-deck", "reader-history"] as const)
  for (const ending of [
    "SDK deadline",
    "SDK deadline before marker",
    "shutdown while starting",
  ] as const) {
    test(`${name} fixture terminates its never-ready engine before ${ending} cleanup returns`, async ({
      onTestFinished,
    }) => {
      const creating = mkdtemp(join(tmpdir(), "inside-owned-browser-fixture-"));
      const cleanup: {
        fixture?: ReturnType<typeof createOwnedBrowserFixture>;
      } = {};
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
      const deadline = ending !== "shutdown while starting";
      await writeFile(
        executable,
        ending === "SDK deadline before marker"
          ? `#!/bin/sh\ntrap '' TERM\nexec /bin/sleep 600\n`
          : `#!/bin/sh\ntrap '' TERM\nprintf '%s' "$$" > '${marker}.tmp'\nmv '${marker}.tmp' '${marker}'\nexec /bin/sleep 600\n`,
        { mode: 0o700 },
      );
      const fixture = createOwnedBrowserFixture(name, {
        startupTimeoutMs: 20_000,
        browserLaunchTimeoutMs: deadline ? 1_000 : 30_000,
        browserExecutablePath: executable,
      });
      cleanup.fixture = fixture;
      const outcome = fixture.start().catch((error: unknown) => error);
      let pid: number;
      if (deadline) {
        const failure = await outcome;
        expect(failure).toBeInstanceOf(Error);
        if (!(failure instanceof Error))
          throw new Error("Missing SDK launch failure");
        expect(failure.message).toContain("Timeout 1000ms exceeded");
        expect(failure.message).toContain(executable);
        // The pinned SDK records acquisition before the executable can write its own marker (#2349).
        const launched = /<launched> pid=(\d+)/u.exec(failure.message);
        pid = z.coerce.number().int().positive().parse(launched?.[1]);
        expect(isRunning(pid)).toBe(false);
      } else {
        await expect
          .poll(() => existsSync(marker), { timeout: 20_000 })
          .toBe(true);
        pid = z.coerce
          .number()
          .int()
          .positive()
          .parse(await readFile(marker, "utf8"));
        expect(isRunning(pid)).toBe(true);
      }
      const original = existsSync(marker)
        ? await readFile(marker, "utf8")
        : null;
      if (original !== null) expect(Number(original)).toBe(pid);
      if (ending === "SDK deadline before marker") expect(original).toBe(null);
      await fixture.close();
      await expect(outcome).resolves.toBeInstanceOf(Error);
      expect(isRunning(pid)).toBe(false);
      await expect(fixture.start()).rejects.toThrow(
        "Browser fixture is closed",
      );
      if (original !== null)
        expect(await readFile(marker, "utf8")).toBe(original);
      else expect(existsSync(marker)).toBe(false);
      expect(isRunning(pid)).toBe(false);
    }, 30_000);
  }
