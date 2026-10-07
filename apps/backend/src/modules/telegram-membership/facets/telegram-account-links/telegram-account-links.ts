import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  TelegramMembershipPrisma,
  TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { parseAccountId } from "../../../accounts/index.js";
import { z } from "zod";

export type ConfirmedTelegramAccountLink = Readonly<{
  accountId: string;
  accountRef: string;
  telegramIdentityRef: string;
}>;
const IDENTITY_CHUNK = 5_000;

export type CurrentAccountsResult =
  | { readonly ok: true; readonly accounts: ReadonlyMap<string, string> }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };
export type TelegramAccountLinkResult =
  | { readonly ok: true; readonly link: ConfirmedTelegramAccountLink | null }
  | { readonly ok: false };

// The linking protocol's accountRef is an opaque principalRef, not Account.id.
// Read only confirmed associations from the capability that owns their lifecycle.
export class TelegramAccountLinks {
  constructor(private readonly prisma: TelegramMembershipPrismaClient) {}

  /** Exact current verified identity only; historical links and usernames are never recipients. */
  async findCurrentByIdentity(identityRef: string) {
    if (!z.string().trim().min(1).max(256).safeParse(identityRef).success)
      return { ok: false as const };
    try {
      const rows = await this.prisma.telegramAccountLinkState.findMany({
        where: { identityRef, principalRef: { not: null } },
        take: 2,
      });
      if (rows.length > 1)
        return { ok: true as const, state: "ambiguous" as const };
      const row = rows[0];
      if (row?.principalRef == null || row.identityRef === null)
        return { ok: true as const, state: "not_found" as const };
      return {
        ok: true as const,
        state: "found" as const,
        recipient: {
          accountId: row.accountId,
          accountRef: row.principalRef,
          identityRef: row.identityRef,
          linkRef: row.linkRef,
          linkRevision: row.revision,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "findCurrentByIdentity" },
        error,
        { ok: false as const },
      );
    }
  }

  /**
   * Current Account of each verified identity, by the same rule as `findCurrentByIdentity`:
   * an identity linked to several Accounts is ambiguous and resolves to none.
   */
  async findCurrentAccounts(
    identityRefs: readonly string[],
  ): Promise<CurrentAccountsResult> {
    const parsed = z
      .array(z.string().trim().min(1).max(256))
      .safeParse(identityRefs);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    const accounts = new Map<string, string>();
    if (parsed.data.length === 0) return { ok: true, accounts };
    try {
      const unique = [...new Set(parsed.data)];
      const rows = [];
      // One bounded query per chunk keeps each parameter list small however large the set grows.
      for (let start = 0; start < unique.length; start += IDENTITY_CHUNK)
        rows.push(
          ...(await this.prisma.telegramAccountLinkState.findMany({
            where: {
              identityRef: { in: unique.slice(start, start + IDENTITY_CHUNK) },
              principalRef: { not: null },
            },
            select: { accountId: true, identityRef: true },
          })),
        );
      const ambiguous = new Set<string>();
      for (const row of rows) {
        if (row.identityRef === null) continue;
        if (accounts.has(row.identityRef)) ambiguous.add(row.identityRef);
        accounts.set(row.identityRef, row.accountId);
      }
      for (const identityRef of ambiguous) accounts.delete(identityRef);
      return { ok: true, accounts };
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "findCurrentAccounts" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }

  /** Durable binding snapshots for community delivery; null identity is an unlink tombstone. */
  async readBinding(
    query: {
      readonly accountId: string;
      readonly revision?: number;
    },
    transaction?: Pick<
      TelegramMembershipPrisma,
      "telegramAccountLinkState" | "telegramAccountLinkHistory"
    >,
  ) {
    if (
      !z
        .object({
          accountId: z.uuid(),
          revision: z.number().int().positive().optional(),
        })
        .strict()
        .safeParse(query).success
    )
      return { ok: false as const };
    try {
      const prisma = transaction ?? this.prisma;
      const row =
        query.revision === undefined
          ? await prisma.telegramAccountLinkState.findUnique({
              where: { accountId: query.accountId },
            })
          : await prisma.telegramAccountLinkHistory.findUnique({
              where: {
                accountId_revision: {
                  accountId: query.accountId,
                  revision: query.revision,
                },
              },
            });
      return {
        ok: true as const,
        binding:
          row === null
            ? null
            : {
                linkRef: row.linkRef,
                linkRevision: row.revision,
                accountRef: row.principalRef,
                telegramIdentityRef: row.identityRef,
              },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "readBinding" },
        error,
        { ok: false as const },
      );
    }
  }

  async find(
    query: { readonly accountId: string } | { readonly accountRef: string },
  ): Promise<TelegramAccountLinkResult> {
    if (
      "accountId" in query
        ? parseAccountId(query.accountId) === undefined
        : !z.string().min(1).max(256).safeParse(query.accountRef).success
    ) {
      return { ok: true, link: null };
    }
    try {
      const rows = await this.prisma.telegramLinkTransaction.findMany({
        where: {
          ...("accountId" in query
            ? { accountId: query.accountId }
            : { principalRef: query.accountRef }),
          status: "linked",
          providerIdentityRef: { not: null },
        },
        take: 2,
        select: {
          accountId: true,
          principalRef: true,
          providerIdentityRef: true,
        },
      });
      const row = rows[0];
      // Ambiguous persisted ownership must not select an arbitrary author.
      if (rows.length !== 1 || row?.providerIdentityRef == null)
        return { ok: true, link: null };
      return {
        ok: true,
        link: {
          accountId: row.accountId,
          accountRef: row.principalRef,
          telegramIdentityRef: row.providerIdentityRef,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "find" },
        error,
        { ok: false },
      );
    }
  }
}
