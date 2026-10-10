import { isLoginEmailReserved } from "../../infrastructure/postgres/login-email-intents.js";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockAccountRecords,
  type AccountsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  newAccountId,
  parseAccountId,
} from "../../domain/account-identifiers.js";
import type { EstablishAccountResult } from "../../facets/accounts/accounts.interface.js";
import type { VerifiedTelegramAccountSignIn } from "../../facets/accounts/verified-logto-identity.js";
import { appendAccountAuditEvent } from "../../infrastructure/postgres/account-audit.js";
import {
  fingerprintEmail,
  validLogtoIdentity,
} from "../../shared/account-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

export async function establishTelegramAccount(
  prisma: AccountsPrismaClient,
  identity: VerifiedTelegramAccountSignIn,
  emailFingerprintKey: string,
): Promise<EstablishAccountResult> {
  const emailFingerprint =
    identity.verifiedEmail === undefined
      ? undefined
      : fingerprintEmail(identity.verifiedEmail, emailFingerprintKey);
  if (
    !validLogtoIdentity(identity) ||
    !z.uuid().safeParse(identity.telegram.subjectRef).success ||
    (identity.verifiedEmail !== undefined && emailFingerprint === undefined)
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockAccountRecords(transaction, [
        `logto:${JSON.stringify([identity.issuer, identity.subject])}`,
        `telegram:${identity.telegram.subjectRef}`,
        ...(emailFingerprint === undefined
          ? []
          : [`email:${emailFingerprint}` as const]),
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
      if (emailFingerprint !== undefined) {
        if (await isLoginEmailReserved(transaction, emailFingerprint)) {
          return { ok: false, error: { code: "identity_conflict" } };
        }
        const emailOwner = await transaction.account.findUnique({
          where: { emailFingerprint },
          select: { id: true },
        });
        if (emailOwner !== null && emailOwner.id !== existing?.id) {
          await appendAccountAuditEvent(
            transaction,
            "duplicate_identity_rejected",
            existing === null ? undefined : parseAccountId(existing.id),
          );
          return { ok: false, error: { code: "identity_conflict" } };
        }
      }
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
          data: {
            telegramSubjectRef: identity.telegram.subjectRef,
            ...(emailFingerprint === undefined ? {} : { emailFingerprint }),
          },
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
          ...(emailFingerprint === undefined ? {} : { emailFingerprint }),
        },
      });
      await appendAccountAuditEvent(transaction, "account_created", accountId);
      return { ok: true, account: { accountId } };
    });
  } catch (error) {
    return dependencyFailure(
      { module: "accounts", operation: "establishTelegramAccount" },
      error,
      internalFailure(),
    );
  }
}
