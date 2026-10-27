import { z } from "zod";

import { hasText } from "../../../../infrastructure/contracts/text.js";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { billingContactProtection } from "../../infrastructure/billing-contact-protection.js";
import { fingerprintEmail } from "../../shared/account-input.js";

/** The most Accounts one facts read accepts. */
export const ACCOUNT_DIRECTORY_FACTS_LIMIT = 100;

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
          ? this.open(account.id, envelope)
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
   * Accounts whose verified email is exactly this address, by the same fingerprint as
   * `Account.emailFingerprint`: no partial match and no decryption of other rows. An address that
   * does not normalize matches nothing.
   */
  async findByEmail(email: string): Promise<AccountEmailMatchResult> {
    const fingerprint = fingerprintEmail(
      email,
      this.dependencies.emailFingerprintKey,
    );
    if (fingerprint === undefined) return { ok: true, accountIds: [] };
    try {
      const rows = await this.dependencies.prisma.account.findMany({
        where: { emailFingerprint: fingerprint },
        select: { id: true },
        take: 2,
      });
      return { ok: true, accountIds: rows.map((row) => row.id) };
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
  ): {
    readonly email: string | null;
    readonly state: "ready" | "unavailable";
  } {
    const { protection } = this.dependencies;
    if (protection === undefined) return { email: null, state: "unavailable" };
    try {
      return { email: protection.open(accountId, envelope), state: "ready" };
    } catch (error) {
      reportDependencyFailure(
        { module: "accounts", operation: "readDirectoryFacts" },
        error,
      );
      return { email: null, state: "unavailable" };
    }
  }
}
