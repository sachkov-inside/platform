import { practiceDefinitionDigest } from "../../../src/modules/materials/domain/practice-definition.js";
import { fingerprintCommand } from "../../../src/modules/materials/shared/canonical-command-fingerprint.js";
import type { ApplySourcePracticeOperation } from "../../../src/modules/materials/features/import-source-practice/import-source-practice.contract.js";
import type { TestDatabase } from "./test-database.js";

/** Historical restore fixture for the retained read/receipt decoder. Current authoring must not
 * create these rows. It exercises no retired write policy or CAS implementation. */
export async function seedHistoricalPractice(
  database: Pick<TestDatabase, "prisma">,
  command: Parameters<ApplySourcePracticeOperation>[0],
) {
  const definitionDigest = practiceDefinitionDigest(
    command.definition,
    command.sourceReference,
  );
  const receipt = {
    practiceId: command.practiceId,
    practiceVersion: 1,
    definitionDigest,
    materialId: command.materialId,
    boundContentVersion: command.expectedContentVersion,
    publicationState: command.publicationState,
  };
  await database.prisma.practiceDefinition.create({
    data: {
      practiceId: command.practiceId,
      materialId: command.materialId,
      definition: command.definition,
      definitionDigest,
      practiceVersion: 1n,
      boundSourceId: command.sourceReference.materialSourceId,
      boundSourceRevision: command.sourceReference.materialSourceRevision,
      boundContentVersion: BigInt(command.expectedContentVersion),
      publicationState: command.publicationState,
      sourceRepository: command.provenance.repository,
      sourceCommit: command.provenance.commit,
      sourcePath: command.provenance.path,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  await database.prisma.practiceImportReceipt.create({
    data: {
      actorId: command.actor,
      operation: "apply_source_practice",
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: fingerprintCommand({
        operation: "apply_source_practice",
        ...command,
      }),
      receipt,
    },
  });
  return receipt;
}
