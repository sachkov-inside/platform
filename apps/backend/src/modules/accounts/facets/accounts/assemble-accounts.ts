import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { checkPermission } from "../../features/check-permission/check-permission.js";
import { establishAccount } from "../../features/establish-account/establish-account.js";
import { resolveAccount } from "../../features/resolve-account/resolve-account.js";
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
    throw new TypeError("emailFingerprintKey must contain at least 32 characters");
  }
  const accounts: Accounts = {
    async readIdentityForLink(accountId) {
      const row = await prisma.account.findUnique({ where: { id: accountId } });
      return row === null ? undefined : { issuer: row.logtoIssuer, subject: row.logtoSubject, telegramSubjectRef: row.telegramSubjectRef };
    },
    establishAccount: (command) =>
      establishAccount(prisma, emailFingerprintKey, command),
    resolveAccount: (query) => resolveAccount(prisma, query),
    checkPermission: (query) => checkPermission(prisma, query),
  };
  return Object.freeze(accounts);
}
