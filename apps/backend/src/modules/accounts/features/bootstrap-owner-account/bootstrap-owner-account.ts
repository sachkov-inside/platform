import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { newAccountId, parseAccountId } from "../../domain/account-identifiers.js";
import { acquireAccountLocks } from "../../infrastructure/postgres/advisory-locks.js";
import { appendAccountAuditEvent } from "../../infrastructure/postgres/account-audit.js";
import { validLogtoIdentity } from "../../shared/account-input.js";

export interface OwnerBootstrapResult {
  readonly accountId: string;
  readonly accountCreated: boolean;
  readonly permissionGranted: boolean;
}

export async function bootstrapOwnerAccount(
  prisma: AccountsPrismaClient,
  identity: { readonly issuer: string; readonly subject: string },
): Promise<OwnerBootstrapResult> {
  if (!validLogtoIdentity(identity)) {
    throw new TypeError("owner Logto identity is invalid");
  }

  return prisma.$transaction(async (transaction) => {
    await acquireAccountLocks(transaction, [
      `logto:${JSON.stringify([identity.issuer, identity.subject])}`,
    ]);
    const existing = await transaction.account.findUnique({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: identity.issuer,
          logtoSubject: identity.subject,
        },
      },
      select: { id: true },
    });
    const accountId = existing === null ? newAccountId() : parseAccountId(existing.id);
    if (accountId === undefined) {
      throw new Error("persisted owner Account id is invalid");
    }

    if (existing === null) {
      await transaction.account.create({
        data: {
          id: accountId,
          logtoIssuer: identity.issuer,
          logtoSubject: identity.subject,
          emailFingerprint: null,
        },
      });
      await appendAccountAuditEvent(transaction, "account_created", accountId);
    }

    const existingGrant = await transaction.accountPermission.findUnique({
      where: {
        accountId_permission: {
          accountId,
          permission: "materials:manage",
        },
      },
      select: { accountId: true },
    });
    const permissionGranted = existingGrant === null;
    if (permissionGranted) {
      await transaction.accountPermission.create({
        data: { accountId, permission: "materials:manage" },
      });
      await appendAccountAuditEvent(transaction, "permission_granted", accountId);
    }
    if (existing === null || permissionGranted) {
      await appendAccountAuditEvent(
        transaction,
        "owner_bootstrap_completed",
        accountId,
      );
    }
    return {
      accountId,
      accountCreated: existing === null,
      permissionGranted,
    };
  });
}
