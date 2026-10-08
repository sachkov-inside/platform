import { randomBytes, randomUUID } from "node:crypto";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockTelegramMembershipLink,
  type TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  accountId,
  type Accounts,
  type AuthenticatedAccount,
  type LegalAcceptances,
  type VerifiedAccountSignIn,
} from "../../../accounts/index.js";
import type { AccountRights } from "../../../account-rights/index.js";
import { readConfirmedTelegramLink } from "../../infrastructure/persistence/confirmed-telegram-link.js";

export interface TelegramSignInProvider {
  bindAccount(
    requestRef: string,
    subjectRef: string,
    principalRef: string,
  ): Promise<
    | { readonly status: "linked"; readonly telegramIdentityRef: string }
    | { readonly status: "conflict" | "unavailable" }
  >;
}
const linkLifetimeMilliseconds = 5 * 60 * 1000;
interface Dependencies {
  readonly accounts: Accounts;
  readonly prisma: TelegramMembershipPrismaClient;
  readonly provider: TelegramSignInProvider;
  readonly accountRights: AccountRights;
  /** The first sign-in screen gates the bot link: it completes only once the terms are accepted. */
  readonly terms: Pick<LegalAcceptances, "checkTerms">;
}
export class TelegramAccountSignIn {
  constructor(private readonly dependencies: Dependencies) {}

  async complete(identity: VerifiedAccountSignIn) {
    if (identity.telegram === undefined)
      return { ok: false, error: { code: "invalid_input" } } as const;
    const { accounts, prisma, provider } = this.dependencies;
    const established = await accounts.establishAccount({ identity });
    if (!established.ok) return established;
    const account = established.account;
    const telegram = identity.telegram;
    try {
      // Unlike a new email-link attempt, sign-in must retain even an expired principal:
      // the provider may already own it after a lost response. A fresh proof repairs that write.
      // Prefer a confirmed link over old abandoned attempts and never rotate its principal.
      const link = await prisma.$transaction(async (transaction) => {
        await lockTelegramMembershipLink(transaction, account.accountId);
        const current =
          (await readConfirmedTelegramLink(transaction, account.accountId)) ??
          (await transaction.telegramLinkTransaction.findFirst({
            where: { accountId: account.accountId },
            orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
          }));
        if (
          current &&
          ["conflict", "recovery_required", "replayed"].includes(current.status)
        )
          return null;
        if (current) return current;
        const now = new Date();
        return transaction.telegramLinkTransaction.create({
          data: {
            linkRef: telegram.requestRef,
            accountId: account.accountId,
            principalRef: randomUUID(),
            returnCorrelation: telegram.requestRef,
            tokenDigest: randomBytes(32).toString("base64url"),
            status: "registering",
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + linkLifetimeMilliseconds),
          },
        });
      });
      if (link === null)
        return { ok: false, error: { code: "identity_conflict" } } as const;
      const bound = await provider.bindAccount(
        telegram.requestRef,
        telegram.subjectRef,
        link.principalRef,
      );
      if (bound.status !== "linked")
        return {
          ok: false,
          error: {
            code:
              bound.status === "conflict" ? "identity_conflict" : "unavailable",
          },
        } as const;
      if (
        link.providerIdentityRef !== null &&
        link.providerIdentityRef !== bound.telegramIdentityRef
      )
        return { ok: false, error: { code: "identity_conflict" } } as const;
      // Store the receipt before consulting terms. Refresh tokens carry no sign-in proof,
      // but this confirmed request can be checked again for the same Account and principal.
      await prisma.telegramLinkTransaction.update({
        where: { linkRef: link.linkRef },
        data: {
          status: link.status === "linked" ? "linked" : "registering",
          providerIdentityRef: bound.telegramIdentityRef,
          providerTransactionRef: telegram.requestRef,
          returnCorrelation: telegram.requestRef,
          updatedAt: new Date(),
        },
      });
      // Бот подтвердил личность, но связка завершается только после принятия действующих условий
      // на экране первого входа: до этого у аккаунта нет ни членства, ни связанного Telegram.
      // Подтверждённая личность остаётся в попытке, и повторное завершение после принятия
      // доводит ту же связку, не создавая новой.
      const terms = await this.dependencies.terms.checkTerms(account.accountId);
      if (!terms.ok)
        return { ok: false, error: { code: "unavailable" } } as const;
      if (!terms.accepted) {
        return { ok: true, account } as const;
      }
      return await this.finalize(account, link, telegram.requestRef);
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "complete" },
        error,
        { ok: false, error: { code: "unavailable" } } as const,
      );
    }
  }

  /** Resume only an already verified receipt; this operation never establishes an identity. */
  async resume(account: AuthenticatedAccount) {
    const { accounts, prisma, provider, terms } = this.dependencies;
    try {
      const acceptance = await terms.checkTerms(account.accountId);
      if (!acceptance.ok || !acceptance.accepted)
        return { ok: false, error: { code: "unavailable" } } as const;
      const link = await readConfirmedTelegramLink(prisma, account.accountId);
      if (link === null || link.status === "linked")
        return { ok: true, account } as const;
      const identity = await accounts.readIdentityForLink(account.accountId);
      const subjectRef = identity?.telegramSubjectRef;
      if (subjectRef === undefined || subjectRef === null)
        return { ok: false, error: { code: "identity_conflict" } } as const;
      // v10 stored the original sign-in request as linkRef, before recording the provider ref.
      const requestRef = link.providerTransactionRef ?? link.linkRef;
      if (link.returnCorrelation !== requestRef)
        return { ok: false, error: { code: "identity_conflict" } } as const;
      const bound = await provider.bindAccount(
        requestRef,
        subjectRef,
        link.principalRef,
      );
      if (bound.status !== "linked")
        return {
          ok: false,
          error: {
            code:
              bound.status === "conflict" ? "identity_conflict" : "unavailable",
          },
        } as const;
      if (bound.telegramIdentityRef !== link.providerIdentityRef)
        return { ok: false, error: { code: "identity_conflict" } } as const;
      return await this.finalize(account, link, requestRef);
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "resume" },
        error,
        { ok: false, error: { code: "unavailable" } } as const,
      );
    }
  }

  private async finalize(
    account: AuthenticatedAccount,
    link: { readonly linkRef: string; readonly principalRef: string },
    requestRef: string,
  ) {
    return this.dependencies.prisma.$transaction(async (transaction) => {
      await lockTelegramMembershipLink(transaction, account.accountId);
      const principal = await this.dependencies.accountRights.bindPrincipal(
        {
          accountId: accountId(account.accountId),
          principalRef: link.principalRef,
        },
        transaction,
      );
      if (!principal.ok)
        return { ok: false, error: { code: "unavailable" } } as const;
      await transaction.telegramLinkTransaction.update({
        where: { linkRef: link.linkRef },
        data: {
          status: "linked",
          providerTransactionRef: requestRef,
          updatedAt: new Date(),
        },
      });
      return { ok: true, account } as const;
    });
  }

  async resolveLink(
    principalRef: string,
    telegramIdentityRef: string,
    subjectRef: string,
  ) {
    const link =
      await this.dependencies.prisma.telegramLinkTransaction.findUnique({
        where: { principalRef },
      });
    if (
      !link ||
      ["conflict", "recovery_required", "replayed"].includes(link.status) ||
      (link.providerIdentityRef !== null &&
        link.providerIdentityRef !== telegramIdentityRef)
    )
      return undefined;
    const identity = await this.dependencies.accounts.readIdentityForLink(
      link.accountId,
    );
    if (
      !identity ||
      (identity.telegramSubjectRef !== null &&
        identity.telegramSubjectRef !== subjectRef)
    )
      return undefined;
    return { issuer: identity.issuer, subject: identity.subject };
  }
}
