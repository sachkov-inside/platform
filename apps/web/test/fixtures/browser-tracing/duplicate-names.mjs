// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { PlaywrightBrowserProvider } from "@vitest/browser-playwright";

const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "inside-tracing-"));
const commands = new Map();
const project = {
  name: "storybook (chromium)",
  config: { browser: { name: "chromium", trace: {} } },
  browser: { registerCommand: (name, command) => commands.set(name, command) },
};
const provider = new PlaywrightBrowserProvider(project, {});
const browser = await chromium.launch({ tracesDir: directory });
try {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const start = commands.get("__vitest_startChunkTrace");
  for (const [context, sessionId, testPath] of [
    [first, "first", "/stories/first.stories.tsx"],
    [second, "second", "/stories/second.stories.tsx"],
  ]) {
    await start(
      { provider, project, context, sessionId, testPath },
      {
        name: "Mobile-0-0",
        title: "Mobile",
      },
    );
    await context.tracing.group(`${sessionId} file marker`);
    await context.tracing.groupEnd();
  }
  // Keep both chunks open: the second start must not overwrite the first chunk's files.
  const paths = [join(directory, "first.zip"), join(directory, "second.zip")];
  await first.tracing.stopChunk({ path: paths[0] });
  await second.tracing.stopChunk({ path: paths[1] });
  for (const [index, marker, other] of [
    [0, "first", "second"],
    [1, "second", "first"],
  ]) {
    const { stdout } = await run("unzip", ["-p", paths[index], "trace.trace"]);
    assert.ok(
      stdout.includes(`${marker} file marker`),
      `${marker} trace lost its own marker`,
    );
    assert.ok(
      !stdout.includes(`${other} file marker`),
      `${marker} trace contains another file's marker`,
    );
  }
  console.log("Both duplicate-name chunks preserve their own file's trace.");
} finally {
  await browser.close();
  await provider.close();
  await rm(directory, { recursive: true, force: true });
}
