import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { newAccountId, parseAccountId } from "../../domain/account-identifiers.js";
import type {
  EstablishAccountResult,
  VerifiedAccountSignIn,
} from "../../facets/accounts/accounts.interface.js";
import { acquireAccountLocks } from "../../infrastructure/postgres/advisory-locks.js";
import { appendAccountAuditEvent } from "../../infrastructure/postgres/account-audit.js";
import { fingerprintEmail, validLogtoIdentity } from "../../shared/account-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

export async function establishAccount(
  prisma: AccountsPrismaClient,
  emailFingerprintKey: string,
  command: { readonly identity: VerifiedAccountSignIn },
): Promise<EstablishAccountResult> {
  const emailFingerprint = fingerprintEmail(
    command.identity.verifiedEmail,
    emailFingerprintKey,
  );
  if (!validLogtoIdentity(command.identity) || emailFingerprint === undefined) {
    return { ok: false, error: { code: "invalid_input" } };
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireAccountLocks(transaction, [
        `logto:${JSON.stringify([
          command.identity.issuer,
          command.identity.subject,
        ])}`,
        `email:${emailFingerprint}`,
      ]);

      const existing = await transaction.account.findUnique({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: command.identity.issuer,
            logtoSubject: command.identity.subject,
          },
        },
        select: { id: true, emailFingerprint: true },
      });

      if (existing !== null) {
        const accountId = parseAccountId(existing.id);
        if (accountId === undefined) {
          return internalFailure();
        }
        if (existing.emailFingerprint === emailFingerprint) {
          return { ok: true, account: { accountId } };
        }
        const emailOwner = await transaction.account.findUnique({
          where: { emailFingerprint },
          select: { id: true },
        });
        if (emailOwner !== null && emailOwner.id !== accountId) {
          await appendAccountAuditEvent(
            transaction,
            "duplicate_identity_rejected",
            accountId,
          );
          return { ok: false, error: { code: "identity_conflict" } };
        }
        await transaction.account.update({
          where: { id: accountId },
          data: { emailFingerprint },
        });
        return { ok: true, account: { accountId } };
      }

      const emailOwner = await transaction.account.findUnique({
        where: { emailFingerprint },
        select: { id: true },
      });
      if (emailOwner !== null) {
        const ownerId = parseAccountId(emailOwner.id);
        await appendAccountAuditEvent(
          transaction,
          "duplicate_identity_rejected",
          ownerId,
        );
        return { ok: false, error: { code: "identity_conflict" } };
      }

      const accountId = newAccountId();
      await transaction.account.create({
        data: {
          id: accountId,
          logtoIssuer: command.identity.issuer,
          logtoSubject: command.identity.subject,
          emailFingerprint,
        },
      });
      await appendAccountAuditEvent(transaction, "account_created", accountId);
      return { ok: true, account: { accountId } };
    });
  } catch {
    return internalFailure();
  }
}
