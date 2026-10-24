// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyJournaled, withJournal } from "./journal.mjs";
import { assertLegacyTaskReplay } from "./legacy-task-targets.mjs";

test("an uncertain Task command cannot rewrite a legacy Task promised to be preserved", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "legacy-task-replay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await withJournal(directory, "http://127.0.0.1:1710", async (context) => {
    await assert.rejects(
      applyJournaled(
        context,
        {
          path: "/authoring/import/tasks/apply",
          body: { code: "accepted-task" },
        },
        () => {
          throw new Error("response lost");
        },
      ),
      /response lost/u,
    );
    const original = structuredClone(context.journal);
    assert.throws(
      () => assertLegacyTaskReplay(context.journal, new Set(["accepted-task"])),
      /uncertain Task command/u,
    );
    assertLegacyTaskReplay(context.journal, new Set(["another-task"]));
    assert.deepEqual(context.journal, original);
  });
});
