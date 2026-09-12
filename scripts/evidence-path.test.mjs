import assert from "node:assert/strict";
import test from "node:test";

import { evidenceDirectory, evidencePath } from "./evidence-path.mjs";

test("an ordinary run writes snapshots outside the repository tree", () => {
  for (const environment of [{}, { UPDATE_EVIDENCE: "" }, { UPDATE_EVIDENCE: "   " }]) {
    const directory = evidenceDirectory("issue-529", environment);
    assert.match(directory, /ci-artifacts\/evidence\/issue-529$/u);
    assert.doesNotMatch(directory, /docs\/evidence/u);
  }
});

test("an explicit update writes only into the folder of its own issue", () => {
  const environment = { UPDATE_EVIDENCE: "issue-529" };
  assert.match(evidenceDirectory("issue-529", environment), /docs\/evidence\/issue-529$/u);
  // Прогон снимает и соседние сценарии: их свидетельства по-прежнему уходят в артефакты.
  assert.match(evidenceDirectory("issue-122", environment), /ci-artifacts\/evidence\/issue-122$/u);
  assert.match(evidenceDirectory("issue-5290", environment), /ci-artifacts\/evidence\/issue-5290$/u);
});

test("a snapshot keeps its file name under the directory the rule chose", () => {
  assert.match(
    evidencePath("issue-49", "landing-desktop.png", { UPDATE_EVIDENCE: "issue-49" }),
    /docs\/evidence\/issue-49\/landing-desktop\.png$/u,
  );
  assert.match(
    evidencePath("issue-49", "landing-desktop.png", {}),
    /ci-artifacts\/evidence\/issue-49\/landing-desktop\.png$/u,
  );
});

test("a misspelled issue folder fails loudly instead of writing nowhere visible", () => {
  for (const requested of ["529", "issue-529/", "docs/evidence/issue-529"]) {
    assert.throws(
      () => evidenceDirectory("issue-529", { UPDATE_EVIDENCE: requested }),
      /UPDATE_EVIDENCE must name an issue folder/u,
    );
  }
});
