import { z } from "zod";
import type { AccountRightsPrisma } from "../../infrastructure/prisma.js";
import {
  capabilitiesSchema,
  sourceRefSchema,
} from "../../domain/access-grant.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

const querySchema = z
  .array(
    z.strictObject({
      accountId: z.uuid().toLowerCase(),
      sourceRef: sourceRefSchema,
    }),
  )
  .max(500);
const rowSchema = z.object({
  accountId: z.uuid(),
  sourceRef: sourceRefSchema,
  capabilities: capabilitiesSchema,
  startsAt: z.date(),
  validUntil: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

/** Trusted read-only Billing composition. This reports paid provenance, never effective access. */
export async function readPaidGrantDiagnostics(
  prisma: Pick<AccountRightsPrisma, "accessGrant">,
  input: readonly { readonly accountId: string; readonly sourceRef: string }[],
) {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: { code: "invalid_input" as const } };
  const keys = [
    ...new Map(
      parsed.data.map((key) => [
        JSON.stringify([key.accountId, key.sourceRef]),
        key,
      ]),
    ).values(),
  ];
  try {
    const rows =
      keys.length === 0
        ? []
        : await prisma.accessGrant.findMany({
            where: { source: "paid", OR: keys },
            select: {
              accountId: true,
              sourceRef: true,
              capabilities: true,
              startsAt: true,
              validUntil: true,
              revokedAt: true,
            },
          });
    return {
      ok: true as const,
      values: rows.map((row) => {
        const value = rowSchema.parse(row);
        return {
          accountId: value.accountId,
          sourceRef: value.sourceRef,
          capabilities: value.capabilities,
          startsAt: value.startsAt.toISOString(),
          validUntil: value.validUntil?.toISOString() ?? null,
          revokedAt: value.revokedAt?.toISOString() ?? null,
        };
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "account-rights", operation: "readPaidGrantDiagnostics" },
      error,
      { ok: false as const, error: { code: "unavailable" as const } },
    );
  }
}
