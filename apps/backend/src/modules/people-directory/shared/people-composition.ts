import type { AccessGrants } from "../../account-rights/index.js";
import type {
  AccountDirectory,
  AccountDirectoryFacts,
  Accounts,
} from "../../accounts/index.js";
import type { BillingOperations } from "../../billing/index.js";
import type { Notifications } from "../../notifications/index.js";
import type { SubmissionReview } from "../../product-tasks/index.js";
import type { ProductDiscovery } from "../../products/index.js";
import type { ReadingActivity } from "../../reading-activity/index.js";
import type { ProductWaitlists } from "../../sales-funnel/index.js";
import type {
  CommunityEntitlements,
  TelegramAccountLinks,
} from "../../telegram-membership/index.js";
import type { PersonSearchTerm } from "../domain/person-search-term.js";

/** The most Accounts one Telegram contact read accepts. */
const CONTACTS_CHUNK = 100;

/**
 * How the owner sees one person (#1721): the name and @username of the linked Telegram account,
 * never the Account Profile (privacy-v6), and the verified Billing Contact address. The Account ID
 * is the key; the web shows it small, never as the title.
 */
export interface PersonIdentity {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly username: string | null;
  readonly email: string | null;
  /**
   * `partial`: a fact exists but could not be read now (Telegram did not answer for a linked
   * account, or a verified Billing Contact could not be opened). A null field is then unknown, not
   * absent, and the web must not present it as «no contacts».
   */
  readonly contactsState: "complete" | "partial";
}

/**
 * `unavailable` means the text was a name or @username and Telegram could not search it: the empty
 * list is then no answer, and the web says so instead of «никого не нашли». `truncated` means more
 * people matched the text than one answer holds (Telegram reported more name matches than asked
 * for, or more Accounts share the address): the answer, and a list's total, cover only the first
 * matches, and the web asks for a more precise text.
 */
export type NameSearchState = "available" | "unavailable" | "truncated";

export type PeopleDirectoryError =
  | { readonly code: "invalid_request" }
  | { readonly code: "forbidden" }
  | { readonly code: "not_found" }
  | { readonly code: "dependency_unavailable" };

export type PeopleDirectoryResult<
  Value,
  Code extends PeopleDirectoryError["code"] = Exclude<
    PeopleDirectoryError["code"],
    "not_found"
  >,
> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly error: Extract<PeopleDirectoryError, { code: Code }>;
    };

/** The owners whose facts the directory composes; it owns no table of its own. */
export interface PeopleDirectoryDependencies {
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly directory: Pick<
    AccountDirectory,
    "readDirectoryFacts" | "findByEmail" | "listDirectory"
  >;
  readonly telegram: Pick<
    TelegramAccountLinks,
    | "readBindings"
    | "readContacts"
    | "readContactsWithMarketing"
    | "searchContacts"
    | "listLinkedAccountIds"
  >;
  readonly access: Pick<
    AccessGrants,
    "listAccessAccounts" | "readAccessSummaries" | "readAccountProductAccess"
  >;
  readonly products: Pick<ProductDiscovery, "metadata">;
  readonly learning: Pick<
    ReadingActivity,
    "readLastActivity" | "readLearningSummary"
  >;
  readonly payments: Pick<BillingOperations, "execute">;
  readonly submissions: Pick<SubmissionReview, "summarizeAccount">;
  readonly community: Pick<
    CommunityEntitlements,
    "readMemberState" | "listProblemAccounts"
  >;
  readonly deliveries: Pick<Notifications, "listTelegramProblemAccounts">;
  readonly waitlists: Pick<ProductWaitlists, "readForAccount">;
}

export const failure = <const Code extends PeopleDirectoryError["code"]>(
  code: Code,
) => ({ ok: false, error: { code } }) as const;

/**
 * Every read of the directory first requires `billing:manage`; another Account is refused rather
 * than answered with an empty list. `undefined` means allowed.
 */
export async function authorizePeopleRead(
  dependencies: Pick<PeopleDirectoryDependencies, "accounts">,
  actorId: string,
): Promise<
  ReturnType<typeof failure<"forbidden" | "dependency_unavailable">> | undefined
> {
  const decision = await dependencies.accounts.checkPermission({
    accountId: actorId,
    permission: "billing:manage",
  });
  if (!decision.ok) return failure("dependency_unavailable");
  return decision.allowed ? undefined : failure("forbidden");
}

/** Whether Accounts alone makes this Account a person (Sign-in Email or verified Billing Contact). */
export function qualifiesByAccount(fact: AccountDirectoryFacts): boolean {
  return (
    fact.hasSignInEmail ||
    fact.billingEmail !== null ||
    fact.billingEmailState === "unavailable"
  );
}

/** What Accounts and the link set say about one person before Telegram names are read. */
export interface PersonFacts {
  readonly accountId: string;
  readonly billingEmail: string | null;
  readonly billingEmailState: "ready" | "unavailable";
  readonly linked: boolean;
}

/**
 * Identities of known people in the given order: Telegram names of the linked ones are read live
 * in chunks of 100. Names are optional facts of the label: a failed read, already recorded by its
 * owner, leaves the names unknown and the identity `partial`.
 */
export async function identifyPeople(
  dependencies: Pick<PeopleDirectoryDependencies, "telegram">,
  people: readonly PersonFacts[],
): Promise<readonly PersonIdentity[]> {
  const linked = people
    .filter((person) => person.linked)
    .map((person) => person.accountId);
  const contacts = new Map<
    string,
    {
      readonly displayName: string | null;
      readonly telegramUsername: string | null;
      readonly telegramContactState: string;
    }
  >();
  for (let offset = 0; offset < linked.length; offset += CONTACTS_CHUNK) {
    const read = await dependencies.telegram.readContacts(
      linked.slice(offset, offset + CONTACTS_CHUNK),
    );
    if (read.ok)
      for (const [accountId, contact] of read.contacts)
        contacts.set(accountId, contact);
  }
  return people.map((person) => {
    const contact = contacts.get(person.accountId);
    const namesUnknown =
      person.linked && contact?.telegramContactState !== "available";
    return {
      accountId: person.accountId,
      displayName: contact?.displayName ?? null,
      username: contact?.telegramUsername ?? null,
      email: person.billingEmail,
      contactsState:
        namesUnknown || person.billingEmailState === "unavailable"
          ? "partial"
          : "complete",
    };
  });
}

/**
 * People among the candidates, deduplicated by canonical ID, in candidate order: an Account that
 * is not a person is omitted, so a list never shows a visitor as a person.
 */
export async function readPeople(
  dependencies: Pick<PeopleDirectoryDependencies, "directory" | "telegram">,
  candidates: readonly string[],
): Promise<
  PeopleDirectoryResult<readonly PersonIdentity[], "dependency_unavailable">
> {
  const people = await selectPeople(dependencies, candidates);
  if (!people.ok) return people;
  return { ok: true, value: await identifyPeople(dependencies, people.value) };
}

/**
 * The candidates that are people, as `readPeople` decides it from Account facts and Telegram
 * bindings, without reading Telegram names: a caller that needs only the Account IDs, such as the
 * payments of the people a search names, asks Telegram nothing beyond the bindings.
 */
export async function selectPeople(
  dependencies: Pick<PeopleDirectoryDependencies, "directory" | "telegram">,
  candidates: readonly string[],
): Promise<
  PeopleDirectoryResult<readonly PersonFacts[], "dependency_unavailable">
> {
  const ids = [...new Set(candidates.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return { ok: true, value: [] };
  const [facts, bindings] = await Promise.all([
    dependencies.directory.readDirectoryFacts(ids),
    dependencies.telegram.readBindings(ids),
  ]);
  if (!facts.ok || !bindings.ok) return failure("dependency_unavailable");
  const people: PersonFacts[] = [];
  for (const id of ids) {
    const fact = facts.facts.get(id);
    const binding = bindings.bindings.get(id);
    const linked =
      binding?.accountRef != null && binding.telegramIdentityRef !== null;
    if (fact !== undefined && (qualifiesByAccount(fact) || linked))
      people.push({
        accountId: id,
        billingEmail: fact.billingEmail,
        billingEmailState: fact.billingEmailState,
        linked,
      });
  }
  return { ok: true, value: people };
}

/**
 * The Accounts one search term names, before the person predicate: an Account ID, the exact
 * email matches, or Telegram's name and @username matches over current links, at most `limit`.
 * A name text that Telegram cannot search now reports `nameSearch: "unavailable"`, never an empty
 * answer; more matches than `limit` report `truncated`, never a silent cut.
 */
export async function findCandidates(
  dependencies: Pick<PeopleDirectoryDependencies, "directory" | "telegram">,
  term: PersonSearchTerm,
  limit: number,
): Promise<
  PeopleDirectoryResult<
    {
      readonly accountIds: readonly string[];
      readonly nameSearch: NameSearchState;
    },
    "dependency_unavailable"
  >
> {
  switch (term.kind) {
    case "account_id":
      return {
        ok: true,
        value: { accountIds: [term.accountId], nameSearch: "available" },
      };
    case "email": {
      const found = await dependencies.directory.findByEmail(term.email);
      if (!found.ok) return failure("dependency_unavailable");
      return {
        ok: true,
        value: {
          accountIds: found.accountIds.slice(0, limit),
          nameSearch:
            found.accountIds.length > limit ? "truncated" : "available",
        },
      };
    }
    case "name": {
      const found = await dependencies.telegram.searchContacts(
        term.text,
        limit,
      );
      if (found.ok)
        return {
          ok: true,
          value: {
            accountIds: found.hits.slice(0, limit).map((hit) => hit.accountId),
            nameSearch:
              found.truncated || found.hits.length > limit
                ? "truncated"
                : "available",
          },
        };
      // Text Telegram's search contract does not take (a lone «@», more than 64 characters)
      // names nobody there; a refused or failed search is no answer.
      return {
        ok: true,
        value: {
          accountIds: [],
          nameSearch:
            found.reason === "invalid_query" ? "available" : "unavailable",
        },
      };
    }
  }
}
