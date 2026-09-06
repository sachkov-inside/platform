import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Prisma,
  type TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  accountId,
  type Accounts,
  type VerifiedAccountSignIn,
} from "../../../accounts/index.js";
import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";

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
  readonly membershipEntitlements: MembershipEntitlements;
}
export class TelegramAccountSignIn {
  constructor(private readonly dependencies: Dependencies) {}

  async complete(identity: VerifiedAccountSignIn) {
    if (identity.telegram === undefined)
      return { ok: false, error: { code: "invalid_input" } } as const;
    const { accounts, prisma, provider, membershipEntitlements } =
      this.dependencies;
    const established = await accounts.establishAccount({ identity });
    if (!established.ok) return established;
    const account = established.account;
    const telegram = identity.telegram;
    try {
      // Persist the stable principal before the external write, so a lost response can be retried.
      const link = await prisma.$transaction(async (transaction) => {
        z.array(z.object({ lock: z.string() })).parse(
          await transaction.$queryRaw(Prisma.sql`
          select pg_advisory_xact_lock(hashtextextended(${`telegram-membership-link:${account.accountId}`}, 0::bigint))::text as lock
        `),
        );
        const current =
          (await transaction.telegramLinkTransaction.findFirst({
            where: { accountId: account.accountId, status: "linked" },
            orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
          })) ??
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
      const principal = await membershipEntitlements.bindPrincipal({
        accountId: accountId(account.accountId),
        principalRef: link.principalRef,
      });
      if (!principal.ok)
        return { ok: false, error: { code: "unavailable" } } as const;
      await prisma.telegramLinkTransaction.update({
        where: { linkRef: link.linkRef },
        data: {
          status: "linked",
          providerIdentityRef: bound.telegramIdentityRef,
          providerTransactionRef: telegram.requestRef,
          updatedAt: new Date(),
        },
      });
      return { ok: true, account } as const;
    } catch {
      return { ok: false, error: { code: "unavailable" } } as const;
    }
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
