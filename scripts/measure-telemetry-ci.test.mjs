// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts/measure-telemetry-ci.sh");

for (const exitCode of [0, 7]) {
  test(`resource evidence preserves measurement exit ${exitCode} and actual checkout SHA`, async (context) => {
    const directory = await mkdtemp(
      join(tmpdir(), "inside-telemetry-evidence-"),
    );
    context.after(() => rm(directory, { recursive: true, force: true }));
    const bin = join(directory, "bin");
    const output = join(directory, "evidence");
    await mkdir(bin);
    await writeFile(
      join(bin, "pnpm"),
      `#!/bin/sh\nprintf '%s\\n' '{"syntheticFixture":true}'\nexit ${exitCode}\n`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, "docker"),
      '#!/bin/sh\nprintf "fixture-driver\\n"\n',
      {
        mode: 0o755,
      },
    );
    const result = spawnSync("bash", [script, output], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.status, exitCode, result.stderr);
    assert.equal(
      await readFile(join(output, "source-sha.txt"), "utf8"),
      spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
        .stdout,
    );
    assert.equal(
      await readFile(join(output, "telemetry-resource.log"), "utf8"),
      '{"syntheticFixture":true}\n',
    );
    assert.equal(
      await readFile(join(output, "docker-driver.txt"), "utf8"),
      "fixture-driver\n",
    );
  });
}
