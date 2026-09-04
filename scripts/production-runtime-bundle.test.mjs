import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

describe("production runtime release bundle", () => {
  it("contains the exact runtime and deployment files", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-runtime-bundle-"));
    const bundle = resolve(directory, "production-runtime.tar.gz");
    try {
      const build = spawnSync(
        "bash",
        ["scripts/build-production-runtime-bundle.sh", bundle],
        { encoding: "utf8" },
      );
      assert.equal(build.status, 0, build.stderr);

      const listing = spawnSync("tar", ["-tzf", bundle], { encoding: "utf8" });
      assert.equal(listing.status, 0, listing.stderr);
      assert.deepEqual(listing.stdout.trim().split("\n").sort(), [
        "bin/deploy-release",
        "caddy/maintenance.caddy",
        "caddy/platform.caddy",
        "compose.production.yaml",
      ]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
