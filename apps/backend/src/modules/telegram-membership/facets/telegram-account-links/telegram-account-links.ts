import {
  DIAGNOSTIC_SOURCE_ROW_LIMIT,
  diagnosticSnapshotOptions,
  diagnosticSourceBudgetFailure,
  setDiagnosticStatementBudget,
  type DiagnosticSourceBudgetFailure,
} from "../../../../infrastructure/diagnostic-read-budget.js";
import {
  telegramContactsResponseSchema,
  type TelegramContact,
} from "@inside/contracts/telegram-contact";
import type { TelegramContactsProvider } from "../../ports/telegram-contacts-provider.js";
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
const identityRefsSchema = z.array(z.string().trim().min(1).max(256));

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
    const contacts = new Map<
      string,
      {
        telegramIdentityRef: string | null;
        displayName: string | null;
        telegramUsername: string | null;
        telegramUrl: string | null;
        telegramContactState: "available" | "not_linked" | "unavailable";
      }
    >();
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
    const response =
      queries.length === 0 || this.contactsProvider === undefined
        ? ({ ok: false } as const)
        : await this.contactsProvider.read(queries);
    const parsed = response.ok
      ? telegramContactsResponseSchema.safeParse({
          contractVersion: "inside.telegram-contact.v1",
          contacts: response.contacts,
        })
      : null;
    const profiles = new Map<string, Map<string, TelegramContact | null>>();
    if (parsed?.success === true) {
      for (const contact of parsed.data.contacts) {
        const identities =
          profiles.get(contact.accountRef) ??
          new Map<string, TelegramContact | null>();
        // Duplicate pairs stay ambiguous; opaque keys never share an encoded separator.
        identities.set(
          contact.telegramIdentityRef,
          identities.has(contact.telegramIdentityRef) ? null : contact,
        );
        profiles.set(contact.accountRef, identities);
      }
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
      });
    }
    return { ok: true, contacts } as const;
  }

  /** Exact current verified identity only; historical links and usernames are never recipients. */
  async findCurrentByIdentity(
    identityRef: string,
    transaction?: Pick<TelegramMembershipPrisma, "telegramAccountLinkState">,
  ) {
    if (!z.string().trim().min(1).max(256).safeParse(identityRef).success)
      return { ok: false as const };
    try {
      const rows = await (
        transaction ?? this.prisma
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
  findCurrentAccounts(
    identityRefs: readonly string[],
  ): Promise<CurrentAccountsResult> {
    return this.readCurrentAccounts(this.prisma, identityRefs);
  }

  async findCurrentAccountsForDiagnostics(
    identityRefs: readonly string[],
  ): Promise<CurrentAccountsResult | DiagnosticSourceBudgetFailure> {
    if (!identityRefsSchema.safeParse(identityRefs).success)
      return { ok: false, error: { code: "invalid_request" } };
    if (identityRefs.length === 0) return { ok: true, accounts: new Map() };
    if (identityRefs.length > DIAGNOSTIC_SOURCE_ROW_LIMIT)
      return diagnosticSourceBudgetFailure;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setDiagnosticStatementBudget(transaction);
        const rows = await transaction.telegramAccountLinkState.findMany({
          take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
          select: { accountId: true },
        });
        if (rows.length > DIAGNOSTIC_SOURCE_ROW_LIMIT)
          return diagnosticSourceBudgetFailure;
        return this.readCurrentAccounts(
          transaction,
          identityRefs,
          "findCurrentAccountsForDiagnostics",
        );
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        {
          module: "telegram-membership",
          operation: "findCurrentAccountsForDiagnostics",
        },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }

  private async readCurrentAccounts(
    prisma: TelegramMembershipPrisma,
    identityRefs: readonly string[],
    operation = "findCurrentAccounts",
  ): Promise<CurrentAccountsResult> {
    const parsed = identityRefsSchema.safeParse(identityRefs);
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
          ...(await prisma.telegramAccountLinkState.findMany({
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
        { module: "telegram-membership", operation },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }

  /** Current binding set only: historical revisions retain the single-binding contract. */
  async readBindings(
    accountIds: readonly string[],
    transaction?: Pick<TelegramMembershipPrisma, "telegramAccountLinkState">,
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
          transaction ?? this.prisma
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
