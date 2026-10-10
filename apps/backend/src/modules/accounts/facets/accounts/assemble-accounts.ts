import { LoginEmailIdentity } from "../login-email-identity/login-email-identity.js";
import type { LoginEmailNativeAuthority } from "../login-email-identity/login-email-native-authority.js";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { checkPermission } from "../../features/check-permission/check-permission.js";
import { establishAccount } from "../../features/establish-account/establish-account.js";
import { resolveAccount } from "../../features/resolve-account/resolve-account.js";
import type { Accounts } from "./accounts.interface.js";

interface Dependencies {
  readonly prisma: AccountsPrismaClient;
  readonly emailFingerprintKey: string;
  readonly loginEmailNativeAuthority?: LoginEmailNativeAuthority;
  readonly now?: () => Date;
}

export function assembleAccounts({
  prisma,
  emailFingerprintKey,
  loginEmailNativeAuthority,
  now,
}: Dependencies): Accounts {
  if (emailFingerprintKey.length < 32) {
    throw new TypeError(
      "emailFingerprintKey must contain at least 32 characters",
    );
  }
  const accounts: Accounts = {
    loginEmailIdentity: new LoginEmailIdentity(
      prisma,
      emailFingerprintKey,
      loginEmailNativeAuthority,
      now,
    ),
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
    establishAccount: (command) =>
      establishAccount(prisma, emailFingerprintKey, command),
    resolveAccount: (query) => resolveAccount(prisma, query),
    checkPermission: (query) => checkPermission(prisma, query),
  };
  return Object.freeze(accounts);
}
