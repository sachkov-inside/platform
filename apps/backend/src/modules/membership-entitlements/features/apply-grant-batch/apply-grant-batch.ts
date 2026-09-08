import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  accessFailureSchema,
  grantResultSchema,
} from "../../domain/access-grant.js";
import { previewRowsSchema } from "../preview-grant-batch/preview-grant-batch.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";

const commandSchema = z
  .object({
    operationId: z.uuid(),
    previewRef: z.uuid(),
    expectedRevision: z.number().int().positive(),
    confirmedRows: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(100)
      .refine((rows) => new Set(rows).size === rows.length)
      .transform((rows) => rows.sort()),
  })
  .strict();
export type ApplyGrantBatchCommand = z.input<typeof commandSchema>;
const batchResultSchema = z.union([
  accessFailureSchema,
  z.object({
    ok: z.literal(true),
    rows: z.array(z.object({ rowKey: z.string(), result: grantResultSchema })),
  }),
]);
export type ApplyGrantBatchResult = z.infer<typeof batchResultSchema>;

export async function applyGrantBatch(
  prisma: MembershipEntitlementsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  actorId: string,
  input: ApplyGrantBatchCommand,
  now: Date,
): Promise<ApplyGrantBatchResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  const fingerprint = accessFingerprint({ kind: "applyBatch", ...command });
  return prisma.$transaction(async (transaction) => {
    const receipt = await readAccessReceipt(
      transaction,
      actorId,
      command.operationId,
    );
    if (receipt !== null)
      return receipt.fingerprint === fingerprint
        ? batchResultSchema.parse(receipt.result)
        : accessFailure("operation_conflict");
    await lockAccess(transaction, `batch:${command.previewRef}`);
    const preview = await transaction.accessBatchPreview.findUnique({
      where: { id: command.previewRef },
    });
    if (preview === null || preview.actorId !== actorId)
      return accessFailure("not_found");
    if (preview.revision !== command.expectedRevision)
      return accessFailure("revision_conflict");
    if (preview.expiresAt <= now) return accessFailure("preview_expired");
    const previewRows = previewRowsSchema.parse(preview.rows);
    const rows = previewRows.filter((row) =>
      command.confirmedRows.includes(row.rowKey),
    );
    if (rows.length !== command.confirmedRows.length)
      return accessFailure("invalid_input");
    // Validate every selected mapping before writing any grant.
    for (const row of rows) {
      const identity = await accounts.readIdentityForLink(row.accountId);
      if (row.identityFingerprint === null || identity === undefined)
        return accessFailure("not_found");
      if (accessFingerprint(identity) !== row.identityFingerprint)
        return accessFailure("identity_changed");
    }
    // Stable source order avoids deadlocks between overlapping previews.
    for (const row of [...rows].sort((a, b) =>
      `${a.source}:${a.sourceRef}`.localeCompare(`${b.source}:${b.sourceRef}`),
    )) {
      await lockAccess(transaction, `${row.source}:${row.sourceRef}`);
    }
    const results: Extract<ApplyGrantBatchResult, { ok: true }>["rows"] = [];
    for (const row of rows) {
      const existing = await transaction.accessGrant.findUnique({
        where: {
          source_sourceRef: { source: row.source, sourceRef: row.sourceRef },
        },
      });
      if (existing !== null) {
        results.push({
          rowKey: row.rowKey,
          result: accessFailure("operation_conflict"),
        });
        continue;
      }
      const grantRef = randomUUID();
      await transaction.accessGrant.create({
        data: {
          id: grantRef,
          accountId: row.accountId,
          source: row.source,
          sourceRef: row.sourceRef,
          capabilities: row.terms.capabilities,
          startsAt: new Date(row.terms.startsAt),
          validUntil:
            row.terms.validUntil === null
              ? null
              : new Date(row.terms.validUntil),
          revision: 1,
          reason: row.terms.reason,
        },
      });
      await transaction.accessChange.create({
        data: {
          accountId: row.accountId,
          grantId: grantRef,
          actorId,
          operationId: command.operationId,
          kind: `${row.source}_granted`,
          reason: row.terms.reason,
          recordedAt: now,
        },
      });
      results.push({
        rowKey: row.rowKey,
        result: { ok: true, grantRef, revision: 1 },
      });
    }
    const result = { ok: true as const, rows: results };
    await transaction.accessReceipt.create({
      data: {
        scope: actorId,
        operationId: command.operationId,
        fingerprint,
        result,
        createdAt: now,
      },
    });
    await transaction.accessBatchPreview.update({
      where: { id: preview.id },
      data: { revision: { increment: 1 } },
    });
    return result;
  });
}
