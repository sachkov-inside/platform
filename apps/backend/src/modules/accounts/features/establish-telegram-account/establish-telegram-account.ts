import { z } from "zod";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { newAccountId } from "../../domain/account-identifiers.js";
import type { EstablishAccountResult } from "../../facets/accounts/accounts.interface.js";
import type { VerifiedTelegramAccountSignIn } from "../../facets/accounts/verified-logto-identity.js";
import { acquireAccountLocks } from "../../infrastructure/postgres/advisory-locks.js";
import { appendAccountAuditEvent } from "../../infrastructure/postgres/account-audit.js";
import { validLogtoIdentity } from "../../shared/account-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

export async function establishTelegramAccount(
  prisma: AccountsPrismaClient,
  identity: VerifiedTelegramAccountSignIn,
): Promise<EstablishAccountResult> {
  if (
    !validLogtoIdentity(identity) ||
    !z.uuid().safeParse(identity.telegram.subjectRef).success
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireAccountLocks(transaction, [
        `logto:${JSON.stringify([identity.issuer, identity.subject])}`,
        `telegram:${identity.telegram.subjectRef}`,
      ]);
      const existing = await transaction.account.findUnique({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: identity.issuer,
            logtoSubject: identity.subject,
          },
        },
      });
      const owner = await transaction.account.findUnique({
        where: { telegramSubjectRef: identity.telegram.subjectRef },
      });
      if (
        (owner !== null && owner.id !== existing?.id) ||
        (existing?.telegramSubjectRef != null &&
          existing.telegramSubjectRef !== identity.telegram.subjectRef)
      ) {
        return { ok: false, error: { code: "identity_conflict" } };
      }
      if (existing !== null) {
        await transaction.account.update({
          where: { id: existing.id },
          data: { telegramSubjectRef: identity.telegram.subjectRef },
        });
        return { ok: true, account: { accountId: existing.id } };
      }
      const accountId = newAccountId();
      await transaction.account.create({
        data: {
          id: accountId,
          logtoIssuer: identity.issuer,
          logtoSubject: identity.subject,
          telegramSubjectRef: identity.telegram.subjectRef,
        },
      });
      await appendAccountAuditEvent(transaction, "account_created", accountId);
      return { ok: true, account: { accountId } };
    });
  } catch {
    return internalFailure();
  }
}
