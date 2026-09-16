import { isWithheldCapability } from "@inside/access-capabilities";
import { z } from "zod";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { accessCapabilitySchema, accessFailure, type AccessFailure } from "../../domain/access-grant.js";

/**
 * Собственное основание доступа глазами покупателя: состав, срок и то, чем оно выдано.
 * Операторские поля — причина, ссылка на источник, исполнитель и история — здесь не показываются.
 */
export const ownAccessGroundSchema = z.object({
  source: z.enum(["paid", "manual", "legacy"]),
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
  prisma: MembershipEntitlementsPrismaClient,
  accountId: string,
  now: Date,
): Promise<ReadOwnAccessResult> {
  if (!z.uuid().safeParse(accountId).success) return accessFailure("invalid_input");
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
  return {
    ok: true,
    value: ownAccessSchema.parse({
      // Право, которое не выдаёт ни одно основание, кабинет не показывает и в прежних записях.
      grounds: grants.flatMap((grant) => {
        const capabilities = grant.capabilities.filter((capability) => !isWithheldCapability(capability));
        return capabilities.length === 0 ? [] : [{
          source: grant.source,
          capabilities,
          startsAt: grant.startsAt.toISOString(),
          validUntil: grant.validUntil?.toISOString() ?? null,
          active: grant.startsAt <= now,
        }];
      }),
    }),
  };
}
