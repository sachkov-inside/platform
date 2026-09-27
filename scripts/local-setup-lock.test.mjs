// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

describe("local setup lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "local-setup-lock-test-"));
  after(() => rm(directory, { force: true, recursive: true }));

  it("refuses a second owner with the caller's message and frees the lock on release", async () => {
    const target = join(directory, "refusal");
    const release = await acquireLocalSetupLock("first owner", target);

    await assert.rejects(
      acquireLocalSetupLock("Another session owns the lock", target),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Another session owns the lock");
        assert.ok(error.cause instanceof Error);
        assert.ok("code" in error.cause);
        assert.equal(error.cause.code, "ELOCKED");
        return true;
      },
    );

    await release();
    const releaseAgain = await acquireLocalSetupLock("second owner", target);
    await releaseAgain();
  });
});
