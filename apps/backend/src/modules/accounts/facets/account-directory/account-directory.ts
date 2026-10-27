import { z } from "zod";

import { hasText } from "../../../../infrastructure/contracts/text.js";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type AccountsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { billingContactProtection } from "../../infrastructure/billing-contact-protection.js";
import { countNewPeople } from "../../features/count-new-people/count-new-people.js";
import { isDirectoryPerson } from "../../shared/directory-person.js";
import type { DailyWindow } from "../../../../infrastructure/contracts/daily-window.js";
import { fingerprintEmail } from "../../shared/account-input.js";

/** The most Accounts one facts read accepts. */
export const ACCOUNT_DIRECTORY_FACTS_LIMIT = 100;

/** The most people one directory page returns. */
export const ACCOUNT_DIRECTORY_PAGE_LIMIT = 50;

/**
 * The largest ID set another owner hands to one directory page (current Telegram links, or the
 * Accounts behind an access filter). Both owners refuse a larger set rather than cut it.
 */
export const ACCOUNT_DIRECTORY_ID_SET_LIMIT = 50_000;

/** Accounts one address may match; more is refused rather than cut. */
export const ACCOUNT_EMAIL_MATCH_LIMIT = 50;

/**
 * What Accounts knows about one Account for the owner's people directory (#1721).
 *
 * `hasSignInEmail` is a non-null `Account.emailFingerprint`: it is written only from a verified
 * sign-in email, so no read of the sign-in provider is needed. `billingEmail` is the verified
 * Billing Contact address, or null when there is none. `billingEmailState` says whether that null
 * is an answer: `unavailable` means a verified contact exists but could not be opened here.
 */
export interface AccountDirectoryFacts {
  readonly registeredAt: Date;
  readonly hasSignInEmail: boolean;
  readonly billingEmail: string | null;
  readonly billingEmailState: "ready" | "unavailable";
}

export type AccountDirectoryFactsResult =
  | {
      readonly ok: true;
      /** Keyed by the requested spelling; a missing Account is absent. */
      readonly facts: ReadonlyMap<string, AccountDirectoryFacts>;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

export type AccountEmailMatchResult =
  | { readonly ok: true; readonly accountIds: readonly string[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: "dependency_unavailable" };
    };

/**
 * A place in the directory order (`registeredAt` descending, then Account ID descending).
 * `registeredAt` keeps the database's microseconds: a millisecond value would skip or repeat
 * people registered within one millisecond.
 */
export interface AccountDirectoryPosition {
  readonly registeredAt: string;
  readonly accountId: string;
}

/** One person of a directory page with the facts Accounts owns. */
export interface AccountDirectoryEntry extends AccountDirectoryFacts {
  readonly accountId: string;
}

export interface AccountDirectoryQuery {
  readonly after?: AccountDirectoryPosition;
  readonly limit: number;
  /** Only these Accounts may be listed; absent means every person. */
  readonly restrictTo?: readonly string[];
  /** Accounts with a current Telegram link, which Telegram Membership owns. */
  readonly linkedAccountIds: readonly string[];
}

export type AccountDirectoryPageResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly items: readonly AccountDirectoryEntry[];
        /** Every person the query admits, not only this page; one snapshot with the page. */
        readonly total: number;
        readonly next: AccountDirectoryPosition | null;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

const accountIdSetSchema = z
  .array(z.uuid())
  .max(ACCOUNT_DIRECTORY_ID_SET_LIMIT)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

const directoryQuerySchema = z.strictObject({
  after: z
    .strictObject({
      registeredAt: z.iso.datetime({ precision: 6 }),
      accountId: z.uuid().toLowerCase(),
    })
    .optional(),
  /** `0` reads only the total: no Billing Contact is opened. */
  limit: z.int().min(0).max(ACCOUNT_DIRECTORY_PAGE_LIMIT),
  restrictTo: accountIdSetSchema.optional(),
  linkedAccountIds: accountIdSetSchema,
});

const directoryRowSchema = z.array(
  z.object({
    total: z.number().int().nonnegative(),
    id: z.uuid().nullable(),
    createdAt: z.date().nullable(),
    position: z.iso.datetime({ precision: 6 }).nullable(),
    hasSignInEmail: z.boolean().nullable(),
    emailCiphertext: z.string().nullable(),
  }),
);

export interface AccountDirectoryDependencies {
  readonly prisma: AccountsPrismaClient;
  readonly protection: ReturnType<typeof billingContactProtection> | undefined;
  readonly emailFingerprintKey: string;
}

/**
 * Account facts for the owner's people directory. It decides no right: the composing Module
 * checks `billing:manage` before it calls, and only it may show an address.
 */
export class AccountDirectory {
  constructor(private readonly dependencies: AccountDirectoryDependencies) {}

  /** Facts of at most 100 Accounts; a verified Billing Contact is opened only for these. */
  async readDirectoryFacts(
    accountIds: readonly string[],
  ): Promise<AccountDirectoryFactsResult> {
    const parsed = z
      .array(z.uuid())
      .max(ACCOUNT_DIRECTORY_FACTS_LIMIT)
      .safeParse(accountIds);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    const ids = [...new Set(parsed.data.map((id) => id.toLowerCase()))];
    const facts = new Map<string, AccountDirectoryFacts>();
    if (ids.length === 0) return { ok: true, facts };
    try {
      const { prisma } = this.dependencies;
      const [accounts, contacts] = await Promise.all([
        prisma.account.findMany({
          where: { id: { in: ids } },
          select: { id: true, createdAt: true, emailFingerprint: true },
        }),
        prisma.billingContact.findMany({
          where: {
            accountId: { in: ids },
            verifiedAt: { not: null },
            emailCiphertext: { not: null },
          },
          select: { accountId: true, emailCiphertext: true },
        }),
      ]);
      const sealed = new Map(
        contacts.map((contact) => [contact.accountId, contact.emailCiphertext]),
      );
      const byId = new Map<string, AccountDirectoryFacts>();
      for (const account of accounts) {
        const envelope = sealed.get(account.id);
        const opened = hasText(envelope)
          ? this.open(account.id, envelope, "readDirectoryFacts")
          : ({ email: null, state: "ready" } as const);
        byId.set(account.id, {
          registeredAt: account.createdAt,
          hasSignInEmail: account.emailFingerprint !== null,
          billingEmail: opened.email,
          billingEmailState: opened.state,
        });
      }
      for (const id of parsed.data) {
        const fact = byId.get(id.toLowerCase());
        if (fact !== undefined) facts.set(id, fact);
      }
      return { ok: true, facts };
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "readDirectoryFacts" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }

  /**
   * One page of people, newest registration first: Accounts with a Sign-in Email, a verified
   * Billing Contact or one of `linkedAccountIds`. The page and its total come from one statement,
   * so they share a snapshot; only the returned page's Billing Contacts are opened.
   */
  async listDirectory(
    query: AccountDirectoryQuery,
  ): Promise<AccountDirectoryPageResult> {
    const parsed = directoryQuerySchema.safeParse(query);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    const { after, limit, restrictTo, linkedAccountIds } = parsed.data;
    try {
      const rows = directoryRowSchema.parse(
        await this.dependencies.prisma.$queryRaw(Prisma.sql`
          with people as (
            select account.id, account.created_at,
              account.email_fingerprint is not null as has_sign_in_email,
              contact.email_ciphertext
            from accounts.accounts account
            left join accounts.billing_contacts contact
              on contact.account_id = account.id
              and contact.verified_at is not null
              and contact.email_ciphertext is not null
            where ${isDirectoryPerson(linkedAccountIds)}
            ${
              restrictTo === undefined
                ? Prisma.empty
                : Prisma.sql`and account.id = any(${restrictTo}::uuid[])`
            }
          ),
          total as (select count(*)::int as total from people)
          select total.total, page.id::text as id, page.created_at as "createdAt",
            to_char(page.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as position,
            page.has_sign_in_email as "hasSignInEmail",
            page.email_ciphertext as "emailCiphertext"
          from total
          left join lateral (
            select * from people
            ${
              after === undefined
                ? Prisma.empty
                : Prisma.sql`where (people.created_at, people.id) < (${after.registeredAt}::timestamptz, ${after.accountId}::uuid)`
            }
            order by people.created_at desc, people.id desc
            limit ${limit + 1}
          ) page on true
          order by page.created_at desc, page.id desc
        `),
      );
      const total = rows[0]?.total ?? 0;
      const found = rows.flatMap((row) =>
        row.id === null ||
        row.createdAt === null ||
        row.position === null ||
        row.hasSignInEmail === null
          ? []
          : [
              {
                id: row.id,
                createdAt: row.createdAt,
                position: row.position,
                hasSignInEmail: row.hasSignInEmail,
                emailCiphertext: row.emailCiphertext,
              },
            ],
      );
      const page = found.slice(0, limit);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          items: page.map((row) => {
            const opened = hasText(row.emailCiphertext)
              ? this.open(row.id, row.emailCiphertext, "listDirectory")
              : ({ email: null, state: "ready" } as const);
            return {
              accountId: row.id,
              registeredAt: row.createdAt,
              hasSignInEmail: row.hasSignInEmail,
              billingEmail: opened.email,
              billingEmailState: opened.state,
            };
          }),
          total,
          next:
            found.length > limit && last !== undefined
              ? { registeredAt: last.position, accountId: last.id }
              : null,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "listDirectory" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }

  /**
   * People registered per calendar day of the window (#1719), by the same person rule as
   * `listDirectory`; `linkedAccountIds` is bounded like a directory page's.
   */
  countNewPeople(
    query: DailyWindow & { readonly linkedAccountIds: readonly string[] },
  ) {
    return countNewPeople(
      this.dependencies.prisma,
      query,
      ACCOUNT_DIRECTORY_ID_SET_LIMIT,
    );
  }

  /**
   * Accounts whose verified email is exactly this address, by the same fingerprint as
   * `Account.emailFingerprint`: no partial match and no decryption of other rows. The sign-in
   * match comes first; a verified Billing Contact matches only while its fingerprint belongs to
   * its current revision, so an address replaced by a release without fingerprints never
   * matches. Several Accounts may share one Billing Contact address. An address that does not
   * normalize matches nothing.
   */
  async findByEmail(email: string): Promise<AccountEmailMatchResult> {
    const fingerprint = fingerprintEmail(
      email,
      this.dependencies.emailFingerprintKey,
    );
    if (fingerprint === undefined) return { ok: true, accountIds: [] };
    try {
      const { prisma } = this.dependencies;
      // A sign-in fingerprint is unique: one Account at most.
      const [account, contacts] = await Promise.all([
        prisma.account.findUnique({
          where: { emailFingerprint: fingerprint },
          select: { id: true },
        }),
        prisma.billingContact.findMany({
          where: {
            emailFingerprint: fingerprint,
            verifiedAt: { not: null },
            emailCiphertext: { not: null },
            emailFingerprintRevision: {
              equals: prisma.billingContact.fields.revision,
            },
          },
          orderBy: { accountId: "asc" },
          take: ACCOUNT_EMAIL_MATCH_LIMIT + 1,
          select: { accountId: true },
        }),
      ]);
      if (contacts.length > ACCOUNT_EMAIL_MATCH_LIMIT)
        return dependencyFailure(
          { module: "accounts", operation: "findByEmail" },
          new RangeError("Billing Contact matches exceed their bound"),
          { ok: false, error: { code: "dependency_unavailable" } } as const,
        );
      const accountIds = [
        ...new Set([
          ...(account === null ? [] : [account.id]),
          ...contacts.map((contact) => contact.accountId),
        ]),
      ];
      return { ok: true, accountIds };
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "findByEmail" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }

  private open(
    accountId: string,
    envelope: string,
    operation: "readDirectoryFacts" | "listDirectory",
  ): {
    readonly email: string | null;
    readonly state: "ready" | "unavailable";
  } {
    const { protection } = this.dependencies;
    if (protection === undefined) return { email: null, state: "unavailable" };
    try {
      return { email: protection.open(accountId, envelope), state: "ready" };
    } catch (error) {
      reportDependencyFailure({ module: "accounts", operation }, error);
      return { email: null, state: "unavailable" };
    }
  }
}
