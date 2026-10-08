import { webkit, type Browser } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { captureWebkitFailureDiagnostics } from "../support/webkit-failure-diagnostics";

it("captures WebKit page creation and runner measurements without stderr output, then restores logging", async () => {
  const stderr = vi.spyOn(process.stderr, "write");
  const capture = captureWebkitFailureDiagnostics();
  let browser: Browser | undefined;
  try {
    const initial = await capture.snapshot();
    browser = await webkit.launch();
    const context = await browser.newContext();
    await context.newPage();
    await browser.close();
    browser = undefined;
    const final = await capture.snapshot();
    const logs = capture.logs();
    const messages = [...logs.head, ...logs.tail]
      .map(({ message }) => message)
      .join("\n");
    expect(messages).toContain("<launching>");
    expect(messages).toContain("Playwright.createPage");
    expect(messages).toContain("<process did exit:");
    expect(logs.droppedEntries).toBe(0);
    expect(final.elapsedMilliseconds).toBeGreaterThan(
      initial.elapsedMilliseconds,
    );
    expect(final.worker.memoryUsage.rss).toBeGreaterThan(0);
    expect(final.runner.totalMemoryBytes).toBeGreaterThan(0);
    expect(final.worker.cpuUsage.user).toBeGreaterThanOrEqual(
      initial.worker.cpuUsage.user,
    );
    expect(final.runner.cpus.length).toBeGreaterThan(0);
    if (process.platform === "linux") {
      expect(
        final.linux.find(({ path }) => path === "/proc/stat")?.value,
      ).toContain("cpu");
    } else {
      expect(final.linux).toEqual([]);
    }
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    try {
      await browser?.close();
    } finally {
      capture.restore();
      stderr.mockRestore();
    }
  }

  const previousLength =
    capture.logs().head.length + capture.logs().tail.length;
  const nextBrowser = await webkit.launch();
  try {
    await nextBrowser.newPage();
  } finally {
    await nextBrowser.close();
  }
  expect(capture.logs().head.length + capture.logs().tail.length).toBe(
    previousLength,
  );
}, 30000);

it("bounds browser logs while retaining startup, final stderr and exit on a failed launch", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "inside-webkit-diagnostics-"));
  const executable = join(directory, "failed-browser");
  const capture = captureWebkitFailureDiagnostics();
  try {
    await writeFile(
      executable,
      `#!/bin/sh
printf "fixture-browser-stderr\\n" >&2
i=0
while [ "$i" -lt 6000 ]; do
  printf "%s\\n" "${"x".repeat(1024)}" >&2
  i=$((i + 1))
done
printf "fixture-browser-stderr-final\\n" >&2
exit 7
`,
      { mode: 0o700 },
    );
    await expect(
      webkit.launch({ executablePath: executable }),
    ).rejects.toThrow();
    const logs = capture.logs();
    const messages = [...logs.head, ...logs.tail]
      .map(({ message }) => message)
      .join("\n");
    expect(messages).toContain("[err] fixture-browser-stderr");
    expect(messages).toContain("[err] fixture-browser-stderr-final");
    expect(messages).toContain("exitCode=7");
    expect(logs.droppedEntries).toBeGreaterThan(0);
    expect(logs.bytes).toBeLessThanOrEqual(logs.logByteLimit);
  } finally {
    capture.restore();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
