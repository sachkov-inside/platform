import { z } from "zod";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import type { CoverageCatalog } from "../../ports/coverage-catalog.js";
import { accessFailure } from "../../domain/access-grant.js";
const availabilitySchema = z.strictObject({
  state: z.enum(["available", "expired", "revoked", "unavailable"]),
});
export const ownProductSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string().nullable(),
  name: z.string(),
  materials: availabilitySchema,
  community: availabilitySchema,
});
export async function readOwnProducts(
  prisma: AccountRightsPrismaClient,
  accountId: string,
  _now: Date,
  catalog: CoverageCatalog | undefined,
) {
  if (!z.uuid().safeParse(accountId).success)
    return accessFailure("invalid_input");
  const rows = await prisma.productAccess.findMany({
    where: { accountId },
    orderBy: [{ firstIssuedAt: "asc" }, { productId: "asc" }],
    take: 1001,
  });
  if (rows.length > 1000) return accessFailure("unavailable");
  if (rows.length === 0) return { ok: true as const, value: [] };
  if (catalog === undefined) return accessFailure("unavailable");
  const entries = await catalog.resolveMany([
    { productIds: rows.map((row) => row.productId), materialIds: [] },
  ]);
  const products = new Map(
    entries
      .flat()
      .filter((entry) => entry.kind === "product")
      .map((entry) => [entry.id, entry]),
  );
  return {
    ok: true as const,
    value: rows.map((row) => {
      const product = products.get(row.productId);
      return ownProductSchema.parse({
        id: row.productId,
        slug: product?.slug ?? null,
        name: product?.title ?? "Product",
        materials: { state: row.revokedAt === null ? "available" : "revoked" },
        community: { state: row.revokedAt === null ? "available" : "revoked" },
      });
    }),
  };
}
