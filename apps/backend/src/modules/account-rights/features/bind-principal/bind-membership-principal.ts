import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipPrincipalBinding } from "../../facets/account-rights/account-rights.interface.js";
import type {
  AccountRightsPrismaClient,
  MembershipPrincipalBindingPrisma,
} from "../../infrastructure/prisma.js";

export async function bindMembershipPrincipal(
  prisma: AccountRightsPrismaClient,
  command: { readonly accountId: AccountId; readonly principalRef: string },
  now: Date,
  transaction?: MembershipPrincipalBindingPrisma,
): Promise<MembershipPrincipalBinding> {
  if (
    command.principalRef.length < 1 ||
    command.principalRef.length > 256 ||
    command.principalRef.trim().length === 0
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const bind = async (
    transaction: MembershipPrincipalBindingPrisma,
  ): Promise<MembershipPrincipalBinding> => {
    const inserted = await transaction.$executeRaw(Prisma.sql`
      insert into account_rights.account_bindings (
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
  };
  return transaction === undefined
    ? prisma.$transaction(bind)
    : bind(transaction);
}
