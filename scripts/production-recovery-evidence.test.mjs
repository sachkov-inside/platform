import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateRecoveryEvidence } from "./production-recovery-evidence.mjs";

const validEvidence = {
  schemaVersion: 1,
  drills: [
    {
      backupSet: "20260902-120000F_20260902-180000I",
      databases: ["inside", "logto"],
      mode: "pitr",
      rpoSeconds: 4,
      rtoSeconds: 40,
      targetTimestamp: "2026-09-02T18:01:00Z",
    },
    {
      backupSet: "20260902-120000F_20260902-180000I",
      databases: ["inside", "logto"],
      mode: "empty-host",
      rpoSeconds: 6,
      rtoSeconds: 44,
      targetTimestamp: "2026-09-02T18:02:00Z",
    },
  ],
};

describe("database recovery evidence", () => {
  it("accepts bounded PITR and empty-host proof for both databases", () => {
    assert.equal(validateRecoveryEvidence(validEvidence), validEvidence);
  });

  it("fails closed when RPO, RTO, databases or modes miss the contract", () => {
    assertInvalid({ drills: [{ index: 0, value: { rpoSeconds: 3601 } }] }, /rpoSeconds/u);
    assertInvalid({ drills: [{ index: 1, value: { rtoSeconds: 14_401 } }] }, /rtoSeconds/u);
    assertInvalid({ drills: [{ index: 0, value: { databases: ["inside"] } }] }, /both recovery databases/u);
    const oneMode = structuredClone(validEvidence);
    oneMode.drills = [oneMode.drills[0]];
    assert.throws(() => validateRecoveryEvidence(oneMode), /both required/u);
  });
});

function assertInvalid({ drills }, expected) {
  const evidence = structuredClone(validEvidence);
  for (const { index, value } of drills) {
    evidence.drills[index] = { ...evidence.drills[index], ...value };
  }
  assert.throws(() => validateRecoveryEvidence(evidence), expected);
}
