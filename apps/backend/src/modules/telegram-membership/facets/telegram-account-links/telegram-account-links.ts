import type { TelegramMembershipPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { parseAccountId } from "../../../accounts/index.js";
import { z } from "zod";

export type ConfirmedTelegramAccountLink = Readonly<{
  accountId: string;
  accountRef: string;
  telegramIdentityRef: string;
}>;
export type TelegramAccountLinkResult =
  | { readonly ok: true; readonly link: ConfirmedTelegramAccountLink | null }
  | { readonly ok: false };

// The linking protocol's accountRef is an opaque principalRef, not Account.id.
// Read only confirmed associations from the capability that owns their lifecycle.
export class TelegramAccountLinks {
  constructor(private readonly prisma: TelegramMembershipPrismaClient) {}

  async find(query: { readonly accountId: string } | { readonly accountRef: string }): Promise<TelegramAccountLinkResult> {
    if ("accountId" in query ? parseAccountId(query.accountId) === undefined : !z.string().min(1).max(256).safeParse(query.accountRef).success) {
      return { ok: true, link: null };
    }
    try {
      const rows = await this.prisma.telegramLinkTransaction.findMany({
        where: {
          ...("accountId" in query ? { accountId: query.accountId } : { principalRef: query.accountRef }),
          status: "linked",
          providerIdentityRef: { not: null },
        },
        take: 2,
        select: { accountId: true, principalRef: true, providerIdentityRef: true },
      });
      const row = rows[0];
      // Ambiguous persisted ownership must not select an arbitrary author.
      if (rows.length !== 1 || row === undefined || row.providerIdentityRef === null) return { ok: true, link: null };
      return { ok: true, link: { accountId: row.accountId, accountRef: row.principalRef, telegramIdentityRef: row.providerIdentityRef } };
    } catch {
      return { ok: false };
    }
  }
}
