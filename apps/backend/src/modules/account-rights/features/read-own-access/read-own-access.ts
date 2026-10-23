import {
  productAccessOriginSchema,
  readProductAccessOrigins,
} from "../../shared/product-access-origins.js";
import { z } from "zod";
import {
  coverageEntrySchema,
  productCapability,
} from "@inside/access-capabilities";
import type { CoverageCatalog } from "../../ports/coverage-catalog.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  accessCapabilitySchema,
  accessFailure,
  type AccessFailure,
} from "../../domain/access-grant.js";
export const ownAccessGroundSchema = z.object({
  source: productAccessOriginSchema,
  content: z.array(coverageEntrySchema).optional(),
  capabilities: z.array(accessCapabilitySchema),
  startsAt: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime().nullable(),
  /** Действует ли основание сейчас: началось и не истекло. */
  active: z.boolean(),
});
export const ownAccessSchema = z.object({
  grounds: z.array(ownAccessGroundSchema),
});
export type OwnAccess = z.infer<typeof ownAccessSchema>;
export type ReadOwnAccessResult =
  | AccessFailure<"invalid_input" | "unavailable">
  | { readonly ok: true; readonly value: OwnAccess };

export async function readOwnAccess(
  prisma: AccountRightsPrismaClient,
  accountId: string,
  _now: Date,
  catalog?: CoverageCatalog,
): Promise<ReadOwnAccessResult> {
  if (!z.uuid().safeParse(accountId).success)
    return accessFailure("invalid_input");
  const access = await prisma.productAccess.findMany({
    where: { accountId, revokedAt: null },
    take: 1001,
    orderBy: [{ firstIssuedAt: "asc" }, { productId: "asc" }],
  });
  if (access.length > 1000) return accessFailure("unavailable");
  const origins = await readProductAccessOrigins(
    prisma,
    accountId,
    access.map((row) => row.productId),
  );
  const scopes = access.map((row) => ({
    productIds: [row.productId],
    materialIds: [],
  }));
  const contents =
    catalog === undefined ? [] : await catalog.resolveMany(scopes);
  return {
    ok: true,
    value: ownAccessSchema.parse({
      grounds: access.flatMap((row, index) =>
        (origins.get(row.productId) ?? ["unknown"]).map((source) => ({
          source,
          ...(contents[index] === undefined
            ? {}
            : { content: contents[index] }),
          capabilities: [
            productCapability(row.productId),
            "materials",
            "community",
          ],
          startsAt: row.firstIssuedAt?.toISOString() ?? null,
          validUntil: null,
          active: true,
        })),
      ),
    }),
  };
}
