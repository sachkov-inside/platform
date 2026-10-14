import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { checkPermissionsMany } from "../../features/check-permission/check-permissions-many.js";
import { checkPermission } from "../../features/check-permission/check-permission.js";
import { establishAccount } from "../../features/establish-account/establish-account.js";
import { resolveAccount } from "../../features/resolve-account/resolve-account.js";
import { accountId as checkedAccountId } from "../../domain/account-identifiers.js";
import type { Accounts } from "./accounts.interface.js";

interface Dependencies {
  readonly prisma: AccountsPrismaClient;
  readonly emailFingerprintKey: string;
}

export function assembleAccounts({
  prisma,
  emailFingerprintKey,
}: Dependencies): Accounts {
  if (emailFingerprintKey.length < 32) {
    throw new TypeError(
      "emailFingerprintKey must contain at least 32 characters",
    );
  }
  const accounts: Accounts = {
    async readIdentityForLink(accountId, transaction = prisma) {
      const row = await transaction.account.findUnique({
        where: { id: accountId },
      });
      return row === null
        ? undefined
        : {
            issuer: row.logtoIssuer,
            subject: row.logtoSubject,
            telegramSubjectRef: row.telegramSubjectRef,
          };
    },
    async readIdentitiesForLink(accountIds, transaction = prisma) {
      const requested = [...new Set(accountIds)];
      const canonical = [
        ...new Set(requested.map((id) => checkedAccountId(id).toLowerCase())),
      ];
      const identities = new Map<
        string,
        Awaited<ReturnType<Accounts["readIdentityForLink"]>>
      >();
      for (let offset = 0; offset < canonical.length; offset += 500) {
        const rows = await transaction.account.findMany({
          where: { id: { in: canonical.slice(offset, offset + 500) } },
          select: {
            id: true,
            logtoIssuer: true,
            logtoSubject: true,
            telegramSubjectRef: true,
          },
        });
        for (const row of rows)
          identities.set(row.id, {
            issuer: row.logtoIssuer,
            subject: row.logtoSubject,
            telegramSubjectRef: row.telegramSubjectRef,
          });
      }
      return new Map(
        requested.map((id) => [id, identities.get(id.toLowerCase())]),
      );
    },
    establishAccount: (command) =>
      establishAccount(prisma, emailFingerprintKey, command),
    resolveAccount: (query) => resolveAccount(prisma, query),
    checkPermissionsMany: (query) => checkPermissionsMany(prisma, query),
    checkPermission: (query) => checkPermission(prisma, query),
  };
  return Object.freeze(accounts);
}
