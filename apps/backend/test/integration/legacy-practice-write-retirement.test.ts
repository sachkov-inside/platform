import { afterEach, expect, test } from "vitest";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { fingerprintCommand } from "../../src/modules/materials/shared/canonical-command-fingerprint.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { registerFixedClock } from "../support/fixed-clock.js";
registerFixedClock();
let database: TestDatabase | undefined;
afterEach(async () => database?.dispose());
const actor = "11111111-1111-4111-8111-111111111111";
const command = {
  actor,
  idempotencyKey: "historical-practice",
  practiceId: "fixture:retired",
  materialId: "22222222-2222-4222-8222-222222222222",
  expectedContentVersion: 7,
  expectedPracticeVersion: null,
  definition: {
    schemaVersion: 1 as const,
    title: "Original",
    businessInputs: "Original situation",
    expectedOutcome: "Original outcome",
    allowedFreedom: "Original freedom",
    criteria: [
      {
        id: "one",
        requirement: "Original requirement",
        acceptableEvidence: ["Original evidence"],
      },
    ],
  },
  publicationState: "unpublished" as const,
  sourceReference: {
    materialSourceId: "fixture:lesson",
    materialSourceRevision: "a".repeat(64),
  },
  provenance: {
    repository: "fixture/source",
    commit: "b".repeat(40),
    path: "original.json",
  },
};

test("retired Practice authoring rejects new concurrent operations without rows or receipts, while exact historical receipts remain authorized and immutable", async () => {
  database = await createMigratedTestDatabase();
  const authoring = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (account) => account === actor },
  }).authoring;
  const receipt = {
    practiceId: command.practiceId,
    practiceVersion: 19,
    definitionDigest: "c".repeat(64),
    materialId: command.materialId,
    boundContentVersion: 7,
    publicationState: "unpublished",
  };
  // A historical receipt is independent of present Material availability and Practice version.
  await database.prisma.practiceImportReceipt.create({
    data: {
      actorId: actor,
      operation: "apply_source_practice",
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: fingerprintCommand({
        operation: "apply_source_practice",
        ...command,
      }),
      receipt,
    },
  });
  expect(await authoring.readHistoricalPracticeReceipt(command)).toEqual({
    ok: true,
    value: receipt,
  });
  expect(
    await authoring.readHistoricalPracticeReceipt({
      ...command,
      definition: { ...command.definition, title: "Rewritten" },
    }),
  ).toEqual({ ok: false, error: { code: "idempotency_conflict" } });
  expect(
    await authoring.readHistoricalPracticeReceipt({
      ...command,
      actor: "33333333-3333-4333-8333-333333333333",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  const results = await Promise.all(
    ["new-one", "new-two"].map((idempotencyKey) =>
      authoring.readHistoricalPracticeReceipt({ ...command, idempotencyKey }),
    ),
  );
  expect(results).toEqual([
    { ok: false, error: { code: "practice_definition_retired" } },
    { ok: false, error: { code: "practice_definition_retired" } },
  ]);
  expect(await database.prisma.historicalPracticeDefinition.count()).toBe(0);
  expect(await database.prisma.practiceImportReceipt.findMany()).toMatchObject([
    { idempotencyKey: command.idempotencyKey, receipt },
  ]);
});
