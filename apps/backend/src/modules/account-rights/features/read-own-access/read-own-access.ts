import {
  isWithheldCapability,
  coverageEntrySchema,
  coverageSchema,
  isProductCapability,
} from "@inside/access-capabilities";
import { z } from "zod";
import type { CoverageCatalog } from "../../ports/coverage-catalog.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  accessCapabilitySchema,
  accessFailure,
  type AccessFailure,
} from "../../domain/access-grant.js";

/**
 * Собственное основание доступа глазами покупателя: состав, срок и то, чем оно выдано.
 * Операторские поля — причина, ссылка на источник, исполнитель и история — здесь не показываются.
 */
export const ownAccessGroundSchema = z.object({
  source: z.enum(["paid", "manual", "legacy"]),
  content: z.array(coverageEntrySchema).optional(),
  capabilities: z.array(accessCapabilitySchema),
  startsAt: z.iso.datetime(),
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

/**
 * Отозванные основания не показываются: они больше ничего не открывают. Истёкшее основание
 * тоже скрыто, потому что вопрос кабинета — что доступно сейчас и до какого срока.
 */
export async function readOwnAccess(
  prisma: AccountRightsPrismaClient,
  accountId: string,
  now: Date,
  catalog?: CoverageCatalog,
): Promise<ReadOwnAccessResult> {
  if (!z.uuid().safeParse(accountId).success)
    return accessFailure("invalid_input");
  const grants = await prisma.accessGrant.findMany({
    where: {
      accountId,
      revokedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 1001,
  });
  if (grants.length > 1000) return accessFailure("unavailable");
  const exclusions = await prisma.productAccessExclusion.findMany({
    where: { accountId },
  });
  const contents = await Promise.all(
    grants.map(
      (grant) =>
        catalog?.resolve(
          grant.coverage ?? {
            productIds: grant.capabilities
              .filter(isProductCapability)
              .map((value) => value.slice("product:".length)),
            materialIds: [],
          },
        ) ?? Promise.resolve(undefined),
    ),
  );
  return {
    ok: true,
    value: ownAccessSchema.parse({
      // Право, которое не выдаёт ни одно основание, кабинет не показывает и в прежних записях.
      grounds: grants.flatMap((grant, index) => {
        const excluded = exclusions
          .filter((entry) => entry.grantIds.includes(grant.id))
          .map((entry) => entry.productId);
        const scope =
          grant.coverage === null ? null : coverageSchema.parse(grant.coverage);
        const capabilities = grant.capabilities.filter(
          (capability) =>
            !isWithheldCapability(capability) &&
            (!isProductCapability(capability) ||
              !excluded.includes(capability.slice("product:".length))) &&
            (isProductCapability(capability) ||
              scope === null ||
              scope.wholePlatform === true ||
              scope.materialIds.length > 0 ||
              scope.productIds.length === 0 ||
              !scope.productIds.every((id) => excluded.includes(id))),
        );
        return capabilities.length === 0
          ? []
          : [
              {
                source: grant.source,
                ...(contents[index] === undefined
                  ? {}
                  : {
                      content: contents[index]?.filter(
                        (entry) => !excluded.includes(entry.id),
                      ),
                    }),
                capabilities,
                startsAt: grant.startsAt.toISOString(),
                validUntil: grant.validUntil?.toISOString() ?? null,
                active: grant.startsAt <= now,
              },
            ];
      }),
    }),
  };
}
