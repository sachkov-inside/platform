import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipPrincipalBinding } from "../../facets/membership-entitlements/membership-entitlements.interface.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";

export async function bindMembershipPrincipal(
  prisma: MembershipEntitlementsPrismaClient,
  command: { readonly accountId: AccountId; readonly principalRef: string },
  now: Date,
): Promise<MembershipPrincipalBinding> {
  if (
    command.principalRef.length < 1 ||
    command.principalRef.length > 256 ||
    command.principalRef.trim().length === 0
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  return prisma.$transaction(async (transaction) => {
    const inserted = await transaction.$executeRaw(Prisma.sql`
      insert into membership_entitlements.account_bindings (
        account_id,
        principal_ref,
        linked_at
      ) values (${command.accountId}::uuid, ${command.principalRef}, ${now})
      on conflict do nothing
    `);
    const bindings = await transaction.membershipBinding.findMany({
      where: {
        OR: [
          { accountId: command.accountId },
          { principalRef: command.principalRef },
        ],
      },
      select: { accountId: true, principalRef: true },
    });
    if (
      bindings.length === 1 &&
      bindings[0]?.accountId === command.accountId &&
      bindings[0].principalRef === command.principalRef
    ) {
      return { ok: true, outcome: inserted === 1 ? "bound" : "idempotent" };
    }
    return { ok: false, error: { code: "conflict" } };
  });
}
