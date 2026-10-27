import { telegramTransaction } from "../../infrastructure/transaction.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import {
  telegramContactsResponseSchema,
  type TelegramContactQuery,
} from "@inside/contracts/telegram-contact";
import {
  normalizeTelegramContactSearchQuery,
  TELEGRAM_CONTACT_SEARCH_LIMIT_MAX,
  telegramContactsV2ResponseSchema,
  type TelegramContactMarketing,
  type TelegramContactMatch,
  type TelegramContactV2,
} from "@inside/contracts/telegram-contact-v2";
import type { TelegramContactsProvider } from "../../ports/telegram-contacts-provider.js";
import {
  dependencyFailure,
  writeLog,
} from "../../../../infrastructure/observability/index.js";
import type { TelegramMembershipPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { parseAccountId } from "../../../accounts/index.js";
import { z } from "zod";

export type ConfirmedTelegramAccountLink = Readonly<{
  accountId: string;
  accountRef: string;
  telegramIdentityRef: string;
}>;
const IDENTITY_CHUNK = 5_000;
const LINKED_ACCOUNTS_CHUNK = 5_000;
/** Largest linked set handed to another owner in one composition; the measured bound of #1721. */
const LINKED_ACCOUNTS_BOUND = 50_000;

interface ContactProjection {
  readonly telegramIdentityRef: string | null;
  readonly displayName: string | null;
  readonly telegramUsername: string | null;
  readonly telegramUrl: string | null;
  readonly telegramContactState: "available" | "not_linked" | "unavailable";
  /** `/stop` state; `unknown` when not linked, unreadable or read through v1. */
  readonly marketing: TelegramContactMarketing;
}

interface ContactSearchHit {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly username: string | null;
}

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
  constructor(
    private readonly prisma: TelegramMembershipPrismaClient,
    private readonly contactsProvider?: TelegramContactsProvider,
  ) {}

  /** Current contact for author support; no previous binding or name from an agent report is used. */
  async readContacts(accountIds: readonly string[]) {
    const reading = await this.readContactProjection(accountIds, false);
    if (!reading.ok) return reading;
    const contacts = new Map<string, Omit<ContactProjection, "marketing">>();
    for (const [
      accountId,
      { marketing: _marketing, ...contact },
    ] of reading.contacts)
      contacts.set(accountId, contact);
    return { ok: true, contacts } as const;
  }

  /**
   * `readContacts` plus the `/stop` state of each linked Telegram contact. A Telegram release
   * without the v2 contract answers through v1, and every `marketing` is then `unknown`.
   */
  readContactsWithMarketing(accountIds: readonly string[]) {
    return this.readContactProjection(accountIds, true);
  }

  private async readContactProjection(
    accountIds: readonly string[],
    withMarketing: boolean,
  ): Promise<
    | { readonly ok: true; readonly contacts: Map<string, ContactProjection> }
    | { readonly ok: false }
  > {
    const contacts = new Map<string, ContactProjection>();
    if (!z.array(z.uuid()).max(100).safeParse(accountIds).success)
      return { ok: false } as const;
    const accounts = [...new Set(accountIds)];
    const bindings = await Promise.all(
      accounts.map((accountId) => this.readBinding({ accountId })),
    );
    if (bindings.some((binding) => !binding.ok)) return { ok: false } as const;
    const queries = bindings.flatMap((binding) =>
      binding.ok &&
      binding.binding?.accountRef != null &&
      binding.binding.telegramIdentityRef !== null
        ? [
            {
              accountRef: binding.binding.accountRef,
              telegramIdentityRef: binding.binding.telegramIdentityRef,
            },
          ]
        : [],
    );
    const answered =
      queries.length === 0 || this.contactsProvider === undefined
        ? undefined
        : await this.fetchContacts(
            this.contactsProvider,
            queries,
            withMarketing,
          );
    const profiles = new Map<string, Map<string, TelegramContactV2 | null>>();
    for (const contact of answered ?? []) {
      const identities =
        profiles.get(contact.accountRef) ??
        new Map<string, TelegramContactV2 | null>();
      // Duplicate pairs stay ambiguous; opaque keys never share an encoded separator.
      identities.set(
        contact.telegramIdentityRef,
        identities.has(contact.telegramIdentityRef) ? null : contact,
      );
      profiles.set(contact.accountRef, identities);
    }
    const current = await Promise.all(
      accounts.map((accountId) => this.readBinding({ accountId })),
    );
    for (const [index, accountId] of accounts.entries()) {
      const binding = current[index];
      const previous = bindings[index];
      if (binding === undefined || !binding.ok) return { ok: false } as const;
      const identityRef = binding.binding?.telegramIdentityRef ?? null;
      const stable =
        previous?.ok === true &&
        previous.binding?.linkRevision === binding.binding?.linkRevision &&
        previous.binding?.accountRef === binding.binding?.accountRef &&
        previous.binding?.telegramIdentityRef === identityRef;
      const matched =
        stable && binding.binding?.accountRef != null && identityRef !== null
          ? profiles.get(binding.binding.accountRef)?.get(identityRef)
          : undefined;
      const contact = matched?.status === "available" ? matched : undefined;
      contacts.set(accountId, {
        telegramIdentityRef: identityRef,
        displayName: contact?.displayName ?? null,
        telegramUsername: contact?.username ?? null,
        telegramUrl:
          contact?.username == null ? null : `https://t.me/${contact.username}`,
        telegramContactState:
          identityRef === null
            ? "not_linked"
            : contact === undefined
              ? "unavailable"
              : "available",
        marketing:
          matched == null || matched.status === "not_found"
            ? "unknown"
            : matched.marketing,
      });
    }
    return { ok: true, contacts } as const;
  }

  /** The provider's answer revalidated at this owner; `undefined` leaves every contact unavailable. */
  private async fetchContacts(
    provider: TelegramContactsProvider,
    queries: readonly TelegramContactQuery[],
    withMarketing: boolean,
  ): Promise<readonly TelegramContactV2[] | undefined> {
    if (withMarketing) {
      const response = await provider.readWithMarketing(queries);
      if (response.ok) {
        const parsed = telegramContactsV2ResponseSchema.safeParse({
          contractVersion: "inside.telegram-contact.v2",
          contacts: response.contacts,
        });
        return parsed.success ? parsed.data.contacts : undefined;
      }
      if (response.reason === "unavailable") return undefined;
    }
    const response = await provider.read(queries);
    const parsed = response.ok
      ? telegramContactsResponseSchema.safeParse({
          contractVersion: "inside.telegram-contact.v1",
          contacts: response.contacts,
        })
      : undefined;
    return parsed?.success === true
      ? parsed.data.contacts.map((contact) => ({
          ...contact,
          marketing: "unknown" as const,
        }))
      : undefined;
  }

  /**
   * Accounts whose current link carries a Telegram name or username containing `query`. Each
   * Telegram match is accepted only for the Account that holds exactly that link now. The text
   * is personal data and never logged.
   */
  async searchContacts(
    query: string,
    limit: number,
  ): Promise<
    | {
        readonly ok: true;
        readonly hits: readonly ContactSearchHit[];
        readonly truncated: boolean;
      }
    | {
        readonly ok: false;
        readonly reason: "invalid_query" | "not_supported" | "unavailable";
      }
  > {
    if (
      normalizeTelegramContactSearchQuery(query) === undefined ||
      !z
        .number()
        .int()
        .min(1)
        .max(TELEGRAM_CONTACT_SEARCH_LIMIT_MAX)
        .safeParse(limit).success
    )
      return { ok: false, reason: "invalid_query" };
    if (this.contactsProvider === undefined)
      return { ok: false, reason: "unavailable" };
    const found = await this.contactsProvider.search(query, limit);
    if (!found.ok) return found;
    const resolved = await this.resolveContactMatches(found.matches);
    return resolved.ok
      ? { ok: true, hits: resolved.hits, truncated: found.truncated }
      : { ok: false, reason: "unavailable" };
  }

  /**
   * Keeps a Telegram match only when its pair is the current confirmed link of one Account here:
   * a transferred, unlinked or ambiguous identity resolves to nothing. Order follows the matches.
   */
  private async resolveContactMatches(
    matches: readonly TelegramContactMatch[],
  ): Promise<
    | { readonly ok: true; readonly hits: readonly ContactSearchHit[] }
    | { readonly ok: false }
  > {
    if (matches.length === 0) return { ok: true, hits: [] };
    try {
      const rows = await this.prisma.telegramAccountLinkState.findMany({
        where: {
          identityRef: {
            in: [...new Set(matches.map((match) => match.telegramIdentityRef))],
          },
          principalRef: { not: null },
        },
        select: { accountId: true, principalRef: true, identityRef: true },
      });
      const holders = new Map<string, (typeof rows)[number][]>();
      for (const row of rows)
        if (row.identityRef !== null)
          holders.set(row.identityRef, [
            ...(holders.get(row.identityRef) ?? []),
            row,
          ]);
      const hits: ContactSearchHit[] = [];
      const seen = new Set<string>();
      for (const match of matches) {
        const current = holders.get(match.telegramIdentityRef);
        const holder = current?.length === 1 ? current[0] : undefined;
        if (
          holder?.principalRef !== match.accountRef ||
          seen.has(holder.accountId)
        )
          continue;
        seen.add(holder.accountId);
        hits.push({
          accountId: holder.accountId,
          displayName: match.displayName,
          username: match.username,
        });
      }
      return { ok: true, hits };
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "searchContacts" },
        error,
        { ok: false } as const,
      );
    }
  }

  /**
   * Every Account with a current confirmed link, read in keyset chunks. The set is complete or
   * refused: beyond `LINKED_ACCOUNTS_BOUND` the caller gets `ok: false`, never a silent prefix.
   */
  async listLinkedAccountIds(): Promise<
    | { readonly ok: true; readonly accountIds: readonly string[] }
    | { readonly ok: false }
  > {
    try {
      const accountIds: string[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await this.prisma.telegramAccountLinkState.findMany({
          where: {
            principalRef: { not: null },
            identityRef: { not: null },
            ...(after === undefined ? {} : { accountId: { gt: after } }),
          },
          orderBy: { accountId: "asc" },
          take: LINKED_ACCOUNTS_CHUNK,
          select: { accountId: true },
        });
        accountIds.push(...rows.map((row) => row.accountId));
        if (accountIds.length > LINKED_ACCOUNTS_BOUND) {
          writeLog("error", "linked_accounts_bound_exceeded", {
            module: "telegram-membership",
            operation: "listLinkedAccountIds",
            bound: LINKED_ACCOUNTS_BOUND,
          });
          return { ok: false };
        }
        if (rows.length < LINKED_ACCOUNTS_CHUNK)
          return { ok: true, accountIds };
        after = rows.at(-1)?.accountId;
      }
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "listLinkedAccountIds" },
        error,
        { ok: false } as const,
      );
    }
  }

  /** Exact current verified identity only; historical links and usernames are never recipients. */
  async findCurrentByIdentity(
    identityRef: string,
    transaction?: TransactionHandle,
  ) {
    if (!z.string().trim().min(1).max(256).safeParse(identityRef).success)
      return { ok: false as const };
    try {
      const rows = await (
        transaction === undefined
          ? this.prisma
          : telegramTransaction(transaction)
      ).telegramAccountLinkState.findMany({
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

  /** Current binding set only: historical revisions retain the single-binding contract. */
  async readBindings(
    accountIds: readonly string[],
    transaction?: TransactionHandle,
  ) {
    const parsed = z.array(z.uuid()).safeParse(accountIds);
    if (!parsed.success) return { ok: false as const };
    try {
      const ids = [...new Set(parsed.data.map((id) => id.toLowerCase()))];
      const bindings = new Map<
        string,
        {
          linkRef: string;
          linkRevision: number;
          accountRef: string | null;
          telegramIdentityRef: string | null;
        } | null
      >();
      for (const id of ids) bindings.set(id, null);
      for (let offset = 0; offset < ids.length; offset += 500) {
        const rows = await (
          transaction === undefined
            ? this.prisma
            : telegramTransaction(transaction)
        ).telegramAccountLinkState.findMany({
          where: { accountId: { in: ids.slice(offset, offset + 500) } },
        });
        for (const row of rows)
          bindings.set(row.accountId, {
            linkRef: row.linkRef,
            linkRevision: row.revision,
            accountRef: row.principalRef,
            telegramIdentityRef: row.identityRef,
          });
      }
      // Requested keys retain their spelling; opaque provider/principal references are not UUID codecs.
      return {
        ok: true as const,
        bindings: new Map(
          parsed.data.map((id) => [id, bindings.get(id.toLowerCase()) ?? null]),
        ),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "readBindings" },
        error,
        { ok: false as const },
      );
    }
  }

  /** Durable binding snapshots for community delivery; null identity is an unlink tombstone. */
  async readBinding(
    query: {
      readonly accountId: string;
      readonly revision?: number;
    },
    transaction?: TransactionHandle,
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
      const prisma =
        transaction === undefined
          ? this.prisma
          : telegramTransaction(transaction);
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
