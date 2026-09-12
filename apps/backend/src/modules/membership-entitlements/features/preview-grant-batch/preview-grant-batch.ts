import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  classificationTermsAgree,
  classificationTermsShape,
  grantTermsSchema,
  sourceRefSchema,
  type AccessFailure,
} from "../../domain/access-grant.js";
import { accessFingerprint } from "../../shared/access-receipts.js";

const rowTarget = { rowKey: z.string().min(1).max(100), accountId: z.uuid() };
const grantRowSchema = z
  .object({
    ...rowTarget,
    source: z.enum(["manual", "legacy"]),
    sourceRef: sourceRefSchema,
    terms: grantTermsSchema,
  })
  .strict();
/**
 * Строка классификации проходит тот же предпросмотр, что и выдача: набор аккаунтов виден
 * владельцу до записи. Своего механизма у массовой классификации нет.
 */
const classificationRowSchema = z
  .object({
    ...rowTarget,
    expectedRevision: z.number().int().nonnegative(),
    ...classificationTermsShape,
  })
  .strict();
const rowSchema = z.union([grantRowSchema, classificationRowSchema]);
type BatchRow = z.infer<typeof rowSchema>;
/** Строка выдаёт основание или классифицирует Account; условия выдачи отличают одно от другого. */
export function isGrantRow<Row extends BatchRow | PreviewRow>(
  row: Row,
): row is Extract<Row, { readonly terms: unknown }> {
  return "terms" in row;
}
export function isClassificationRow<Row extends BatchRow | PreviewRow>(
  row: Row,
): row is Exclude<Row, { readonly terms: unknown }> {
  return !("terms" in row);
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
export const previewCommandSchema = z
  .object({ operationId: z.uuid(), rows: z.array(rowSchema).min(1).max(100) })
  .strict()
  .refine((value) => unique(value.rows.map((row) => row.rowKey)))
  .refine((value) =>
    unique(
      value.rows
        .filter(isGrantRow)
        .map((row) => `${row.source}:${row.sourceRef}`),
    ),
  )
  // Один Account классифицируется в наборе один раз: иначе порядок строк решал бы исход.
  .refine((value) =>
    unique(
      value.rows.filter(isClassificationRow).map((row) => row.accountId),
    ),
  )
  .refine((value) =>
    value.rows.every((row) => isGrantRow(row) || classificationTermsAgree(row)),
  );
export type PreviewGrantBatchCommand = z.input<typeof previewCommandSchema>;
const identity = { identityFingerprint: z.string().length(64).nullable() };
export const previewRowsSchema = z.array(
  z.union([
    grantRowSchema.extend(identity),
    classificationRowSchema.extend(identity),
  ]),
);
export type PreviewRow = z.infer<typeof previewRowsSchema>[number];
export type PreviewGrantBatchResult =
  | AccessFailure<"invalid_input" | "operation_conflict">
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
      rows: previewRowsSchema.parse(preview.rows).map((row) => ({
        rowKey: row.rowKey,
        accountId: row.accountId,
        status: row.identityFingerprint === null ? "not_found" : "confirmed",
      })),
    };
  });
}
