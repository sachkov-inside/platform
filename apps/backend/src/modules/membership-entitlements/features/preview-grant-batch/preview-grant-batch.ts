import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  grantTermsSchema,
  sourceRefSchema,
  type AccessFailure,
} from "../../domain/access-grant.js";
import { accessFingerprint } from "../../shared/access-receipts.js";

const rowSchema = z
  .object({
    rowKey: z.string().min(1).max(100),
    accountId: z.uuid(),
    source: z.enum(["manual", "legacy"]),
    sourceRef: sourceRefSchema,
    terms: grantTermsSchema,
  })
  .strict();
export const previewCommandSchema = z
  .object({ operationId: z.uuid(), rows: z.array(rowSchema).min(1).max(100) })
  .strict()
  .refine(
    (value) =>
      new Set(value.rows.map((row) => row.rowKey)).size === value.rows.length,
  )
  .refine(
    (value) =>
      new Set(value.rows.map((row) => `${row.source}:${row.sourceRef}`))
        .size === value.rows.length,
  );
export type PreviewGrantBatchCommand = z.input<typeof previewCommandSchema>;
export const previewRowsSchema = z.array(
  rowSchema.extend({ identityFingerprint: z.string().length(64).nullable() }),
);
export type PreviewGrantBatchResult =
  | AccessFailure
  | {
      readonly ok: true;
      readonly previewRef: string;
      readonly revision: number;
      readonly expiresAt: string;
      readonly rows: readonly {
        readonly rowKey: string;
        readonly accountId: string;
        readonly status: "confirmed" | "not_found";
      }[];
    };
const previewLifetimeMilliseconds = 30 * 60 * 1000;

export async function previewGrantBatch(
  prisma: MembershipEntitlementsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  actorId: string,
  command: PreviewGrantBatchCommand,
  now: Date,
): Promise<PreviewGrantBatchResult> {
  const parsed = previewCommandSchema.safeParse(command);
  if (!parsed.success) return accessFailure("invalid_input");
  const fingerprint = accessFingerprint(parsed.data);
  return prisma.$transaction(async (transaction) => {
    await lockAccess(
      transaction,
      `preview:${actorId}:${parsed.data.operationId}`,
    );
    let preview = await transaction.accessBatchPreview.findUnique({
      where: {
        actorId_operationId: { actorId, operationId: parsed.data.operationId },
      },
    });
    if (preview !== null && preview.fingerprint !== fingerprint)
      return accessFailure("operation_conflict");
    if (preview === null) {
      const rows = await Promise.all(
        parsed.data.rows.map(async (row) => {
          const identity = await accounts.readIdentityForLink(row.accountId);
          return {
            ...row,
            identityFingerprint:
              identity === undefined ? null : accessFingerprint(identity),
          };
        }),
      );
      preview = await transaction.accessBatchPreview.create({
        data: {
          id: randomUUID(),
          actorId,
          operationId: parsed.data.operationId,
          fingerprint,
          rows,
          expiresAt: new Date(now.getTime() + previewLifetimeMilliseconds),
        },
      });
    }
    return {
      ok: true,
      previewRef: preview.id,
      revision: preview.revision,
      expiresAt: preview.expiresAt.toISOString(),
      rows: previewRowsSchema
        .parse(preview.rows)
        .map((row) => ({
          rowKey: row.rowKey,
          accountId: row.accountId,
          status: row.identityFingerprint === null ? "not_found" : "confirmed",
        })),
    };
  });
}
