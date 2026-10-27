import { z } from "zod";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import { sourceRefSchema } from "../../domain/access-grant.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  diagnosticSnapshotOptions,
  setDiagnosticStatementBudget,
} from "../../../../infrastructure/diagnostic-read-budget.js";

const querySchema = z
  .array(
    z.strictObject({
      accountId: z.uuid().toLowerCase(),
      productId: z.uuid().toLowerCase(),
      sourceRef: sourceRefSchema,
    }),
  )
  .max(500);
const sourceSchema = z.object({
  accountId: z.uuid(),
  productId: z.uuid(),
  sourceRef: sourceRefSchema,
  issuedAt: z.date(),
});
const accessSchema = z.object({
  accountId: z.uuid(),
  productId: z.uuid(),
  firstIssuedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

/** Purchase provenance plus current ProductAccess, never passive legacy grant history. */
export async function readPaidGrantDiagnostics(
  prisma: AccountRightsPrismaClient,
  input: readonly {
    readonly accountId: string;
    readonly productId: string;
    readonly sourceRef: string;
  }[],
) {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: { code: "invalid_input" as const } };
  const keys = [
    ...new Map(
      parsed.data.map((key) => [
        JSON.stringify([key.accountId, key.productId, key.sourceRef]),
        key,
      ]),
    ).values(),
  ];
  try {
    const values =
      keys.length === 0
        ? []
        : await prisma.$transaction(async (transaction) => {
            await setDiagnosticStatementBudget(transaction);
            const sources = sourceSchema
              .array()
              .max(500)
              .parse(
                await transaction.productAccessSource.findMany({
                  where: { source: "purchase", OR: keys },
                  take: 501,
                  select: {
                    accountId: true,
                    productId: true,
                    sourceRef: true,
                    issuedAt: true,
                  },
                }),
              );
            const pairs = [
              ...new Map(
                sources.map(({ accountId, productId }) => [
                  JSON.stringify([accountId, productId]),
                  { accountId, productId },
                ]),
              ).values(),
            ];
            const current = accessSchema
              .array()
              .max(500)
              .parse(
                pairs.length === 0
                  ? []
                  : await transaction.productAccess.findMany({
                      where: { OR: pairs },
                      take: 501,
                      select: {
                        accountId: true,
                        productId: true,
                        firstIssuedAt: true,
                        revokedAt: true,
                      },
                    }),
              );
            const byPair = new Map(
              current.map((row) => [
                JSON.stringify([row.accountId, row.productId]),
                row,
              ]),
            );
            return sources.map((source) => {
              const access = byPair.get(
                JSON.stringify([source.accountId, source.productId]),
              );
              if (access?.firstIssuedAt == null)
                throw new Error("purchase_product_access_unavailable");
              return {
                accountId: source.accountId,
                sourceRef: source.sourceRef,
                capabilities: [`product:${source.productId}`],
                startsAt: source.issuedAt.toISOString(),
                validUntil: null,
                revokedAt: access.revokedAt?.toISOString() ?? null,
              };
            });
          }, diagnosticSnapshotOptions);
    return { ok: true as const, values };
  } catch (error) {
    return dependencyFailure(
      { module: "account-rights", operation: "readPaidGrantDiagnostics" },
      error,
      { ok: false as const, error: { code: "unavailable" as const } },
    );
  }
}
