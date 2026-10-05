// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTaskFixtures,
  checkMarker,
  consentedCommand,
  observeCheck,
} from "./task-fixtures.mjs";

test("the v3 fixtures hold a correct and a knowingly bad project whose check shows the difference", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "task-fixtures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = await buildTaskFixtures(root);
  assert.deepEqual(
    cases.map(({ id, consent }) => [id, consent]),
    [
      ["without-consent", null],
      ["with-consent", consentedCommand],
      ["bad-project", consentedCommand],
    ],
  );
  const good = cases[0];
  const bad = cases[2];
  assert.ok(good && bad);
  assert.deepEqual(await observeCheck(good.projectDir), {
    marker: checkMarker,
    observation: {
      createdId: "1",
      repeatedId: "1",
      storedCount: 1,
      ownStatus: "open",
      foreignVisible: false,
    },
  });
  assert.deepEqual(await observeCheck(bad.projectDir), {
    marker: checkMarker,
    observation: {
      createdId: "1",
      repeatedId: "2",
      storedCount: 2,
      ownStatus: "open",
      foreignVisible: true,
    },
  });
  // The bad project may never receive `confirmed` for what it breaks.
  assert.deepEqual(bad.expected["deduplication"], [
    "violation",
    "not_verified",
  ]);
  assert.deepEqual(bad.expected["ownership"], ["violation", "not_verified"]);
  // The oracle never enters a learner project.
  for (const { projectDir } of cases)
    assert.doesNotMatch(
      await readFile(join(projectDir, "README.md"), "utf8"),
      /bad-project|without-consent|with-consent/u,
    );
});
