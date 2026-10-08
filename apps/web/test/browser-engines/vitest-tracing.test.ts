import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("keeps traces of identically named tests in different files separate", async () => {
  const { stdout } = await run(process.execPath, [
    fileURLToPath(
      new URL(
        "../fixtures/browser-tracing/duplicate-names.mjs",
        import.meta.url,
      ),
    ),
  ]);
  expect(stdout.trim()).toBe(
    "Both duplicate-name chunks preserve their own file's trace.",
  );
});
