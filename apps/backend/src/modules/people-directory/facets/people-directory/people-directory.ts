import { z } from "zod";

import type {
  AccountDirectory,
  AccountDirectoryFacts,
  Accounts,
} from "../../../accounts/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { parsePersonSearchTerm } from "../../domain/person-search-term.js";

/** The most people one search returns. */
export const PEOPLE_SEARCH_LIMIT = 20;

/** The most Accounts one identities read accepts. */
export const PEOPLE_IDENTITIES_LIMIT = 100;

/**
 * How the owner sees one person (#1721): the name and @username of the linked Telegram account,
 * never the Account Profile (privacy-v5), and the verified Billing Contact address. The Account ID
 * is the key; the web shows it small, never as the title.
 */
export interface PersonIdentity {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly username: string | null;
  readonly email: string | null;
}

/**
 * `unavailable` means the text was a name or @username and Telegram could not search it: the empty
 * list is then no answer, and the web says so instead of «никого не нашли».
 */
export type NameSearchState = "available" | "unavailable";

export type PeopleDirectoryError =
  | { readonly code: "invalid_request" }
  | { readonly code: "forbidden" }
  | { readonly code: "dependency_unavailable" };

export type PeopleDirectoryResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: PeopleDirectoryError };

export type SearchPeopleResult = PeopleDirectoryResult<{
  readonly items: readonly PersonIdentity[];
  readonly nameSearch: NameSearchState;
}>;

/** A name search over the current Telegram links; the owner re-checks every link it returns. */
export type PersonNameSearch = (
  text: string,
  limit: number,
) => Promise<
  | { readonly ok: true; readonly accountIds: readonly string[] }
  | { readonly ok: false }
>;

export interface PeopleDirectoryDependencies {
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly directory: Pick<
    AccountDirectory,
    "readDirectoryFacts" | "findByEmail"
  >;
  readonly telegram: Pick<
    TelegramAccountLinks,
    "readBindings" | "readContacts"
  >;
  /** Absent until Telegram answers `inside.telegram-contact.v2`: name search is then unavailable. */
  readonly searchNames?: PersonNameSearch;
}

const searchInputSchema = z
  .object({
    query: z.unknown(),
    limit: z.coerce.number().int().min(1).max(PEOPLE_SEARCH_LIMIT).optional(),
  })
  .strict();

const identitiesInputSchema = z
  .array(z.uuid())
  .min(1)
  .max(PEOPLE_IDENTITIES_LIMIT);

const failure = (code: PeopleDirectoryError["code"]) =>
  ({ ok: false, error: { code } }) as const;

/**
 * The owner's people directory (#1721). It composes the facts of Accounts and Telegram Membership
 * and is never a source of rights: every read first requires `billing:manage`, and any other
 * Account is refused rather than answered with an empty list.
 *
 * A person is an Account with a Sign-in Email, a verified Billing Contact or a current Telegram
 * link. Other Accounts are unregistered visitors: search never finds them.
 */
export class PeopleDirectory {
  constructor(private readonly dependencies: PeopleDirectoryDependencies) {}

  /** By Account ID, by exact email, or by name and @username through Telegram. */
  async searchPeople(
    actorId: string,
    input: { readonly query: unknown; readonly limit?: unknown },
  ): Promise<SearchPeopleResult> {
    const parsed = searchInputSchema.safeParse(input);
    const term = parsed.success
      ? parsePersonSearchTerm(parsed.data.query)
      : undefined;
    if (!parsed.success || term === undefined)
      return failure("invalid_request");
    const allowed = await this.authorize(actorId);
    if (allowed !== undefined) return allowed;
    const limit = parsed.data.limit ?? PEOPLE_SEARCH_LIMIT;
    let candidates: readonly string[];
    let nameSearch: NameSearchState = "available";
    switch (term.kind) {
      case "account_id":
        candidates = [term.accountId];
        break;
      case "email": {
        const found = await this.dependencies.directory.findByEmail(term.email);
        if (!found.ok) return failure("dependency_unavailable");
        candidates = found.accountIds;
        break;
      }
      case "name": {
        const found =
          this.dependencies.searchNames === undefined
            ? ({ ok: false } as const)
            : await this.dependencies.searchNames(term.text, limit);
        candidates = found.ok ? found.accountIds : [];
        nameSearch = found.ok ? "available" : "unavailable";
        break;
      }
    }
    const people = await this.readPeople(candidates.slice(0, limit));
    if (!people.ok) return people;
    return { ok: true, value: { items: people.value, nameSearch } };
  }

  /**
   * Identities of known people for a column of another owner's list, in the requested order. An
   * Account that is not a person is omitted, so a list never shows a visitor as a person.
   */
  async readIdentities(
    actorId: string,
    accountIds: unknown,
  ): Promise<PeopleDirectoryResult<readonly PersonIdentity[]>> {
    const parsed = identitiesInputSchema.safeParse(accountIds);
    if (!parsed.success) return failure("invalid_request");
    const allowed = await this.authorize(actorId);
    if (allowed !== undefined) return allowed;
    return this.readPeople(parsed.data);
  }

  private async authorize(
    actorId: string,
  ): Promise<
    { readonly ok: false; readonly error: PeopleDirectoryError } | undefined
  > {
    const decision = await this.dependencies.accounts.checkPermission({
      accountId: actorId,
      permission: "billing:manage",
    });
    if (!decision.ok) return failure("dependency_unavailable");
    return decision.allowed ? undefined : failure("forbidden");
  }

  /** People among the candidates, deduplicated by canonical ID, in candidate order. */
  private async readPeople(
    candidates: readonly string[],
  ): Promise<PeopleDirectoryResult<readonly PersonIdentity[]>> {
    const ids = [...new Set(candidates.map((id) => id.toLowerCase()))];
    if (ids.length === 0) return { ok: true, value: [] };
    const [facts, bindings] = await Promise.all([
      this.dependencies.directory.readDirectoryFacts(ids),
      this.dependencies.telegram.readBindings(ids),
    ]);
    if (!facts.ok || !bindings.ok) return failure("dependency_unavailable");
    const people = ids.filter((id) => {
      const fact = facts.facts.get(id);
      const binding = bindings.bindings.get(id);
      return (
        fact !== undefined &&
        (qualifiesByAccount(fact) ||
          (binding?.accountRef != null && binding.telegramIdentityRef !== null))
      );
    });
    const linked = people.filter(
      (id) => bindings.bindings.get(id)?.telegramIdentityRef != null,
    );
    // Names are optional facts of the label: a failed read, already recorded by its owner, leaves
    // the people listed without them.
    const contacts =
      linked.length === 0
        ? undefined
        : await this.dependencies.telegram.readContacts(linked);
    return {
      ok: true,
      value: people.map((id) => {
        const contact =
          contacts?.ok === true ? contacts.contacts.get(id) : undefined;
        return {
          accountId: id,
          displayName: contact?.displayName ?? null,
          username: contact?.telegramUsername ?? null,
          email: facts.facts.get(id)?.billingEmail ?? null,
        };
      }),
    };
  }
}

function qualifiesByAccount(fact: AccountDirectoryFacts): boolean {
  return (
    fact.hasSignInEmail ||
    fact.billingEmail !== null ||
    fact.billingEmailState === "unavailable"
  );
}
