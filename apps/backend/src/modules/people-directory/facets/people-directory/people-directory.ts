import { z } from "zod";

import { parsePersonSearchTerm } from "../../domain/person-search-term.js";
import { listPeople } from "../../features/list-people/list-people.js";
import { listProductChoices } from "../../features/list-product-choices/list-product-choices.js";
import { readPerson } from "../../features/read-person/read-person.js";
import {
  authorizePeopleRead,
  failure,
  findCandidates,
  readPeople,
  selectPeople,
  type NameSearchState,
  type PeopleDirectoryDependencies,
  type PeopleDirectoryResult,
  type PersonIdentity,
} from "../../shared/people-composition.js";

/** The most people one search returns. */
export const PEOPLE_SEARCH_LIMIT = 20;

/** The most Accounts one identities read accepts. */
export const PEOPLE_IDENTITIES_LIMIT = 100;

export type SearchPeopleResult = PeopleDirectoryResult<{
  readonly items: readonly PersonIdentity[];
  readonly nameSearch: NameSearchState;
}>;

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

/**
 * The owner's people directory (#1721). It composes the facts of Accounts, Telegram Membership,
 * Account Rights, Billing, Reading Activity, Product Tasks and Sales Funnel and is never a source
 * of rights: every read first requires `billing:manage`, and any other Account is refused rather
 * than answered with an empty list.
 *
 * A person is an Account with a Sign-in Email, a verified Billing Contact or a current Telegram
 * link. Other Accounts are unregistered visitors: no read finds them.
 */
export class PeopleDirectory {
  constructor(private readonly dependencies: PeopleDirectoryDependencies) {}

  /** By Account ID, by exact email, or by name and @username through Telegram. */
  async searchPeople(
    actorId: string,
    input: { readonly query: unknown; readonly limit?: unknown },
  ): Promise<SearchPeopleResult> {
    const candidates = await this.findSearchCandidates(actorId, input);
    if (!candidates.ok) return candidates;
    const people = await readPeople(
      this.dependencies,
      candidates.value.accountIds,
    );
    if (!people.ok) return people;
    return {
      ok: true,
      value: {
        items: people.value,
        nameSearch: candidates.value.nameSearch,
      },
    };
  }

  /**
   * The Account IDs of the people the same search finds, without their names or contacts: another
   * owner's search by person, such as payments, joins its own facts by them. Telegram is asked
   * for the name search and the bindings, never for names. `nameSearch` says, as in
   * `searchPeople`, whether an empty list for a name is an answer.
   */
  async searchPersonAccounts(
    actorId: string,
    input: { readonly query: unknown; readonly limit?: unknown },
  ): Promise<
    PeopleDirectoryResult<{
      readonly accountIds: readonly string[];
      readonly nameSearch: NameSearchState;
    }>
  > {
    const candidates = await this.findSearchCandidates(actorId, input);
    if (!candidates.ok) return candidates;
    const people = await selectPeople(
      this.dependencies,
      candidates.value.accountIds,
    );
    if (!people.ok) return people;
    return {
      ok: true,
      value: {
        accountIds: people.value.map((person) => person.accountId),
        nameSearch: candidates.value.nameSearch,
      },
    };
  }

  /**
   * Identities of known people for a column of another owner's list, in the requested order. An
   * Account that is not a person is omitted, so a list never shows a visitor as a person.
   */
  async readIdentities(
    actorId: string,
    accountIds: unknown,
  ): Promise<PeopleDirectoryResult<readonly PersonIdentity[]>> {
    const refused = await authorizePeopleRead(this.dependencies, actorId);
    if (refused !== undefined) return refused;
    const parsed = identitiesInputSchema.safeParse(accountIds);
    if (!parsed.success) return failure("invalid_request");
    return readPeople(this.dependencies, parsed.data);
  }

  /** One page of people with their products, filtered and searched; see `listPeople`. */
  listPeople(actorId: string, input: unknown) {
    return listPeople(this.dependencies, actorId, input);
  }

  /** Every Product to choose in the list filter and the grant dialog; see `listProductChoices`. */
  listProductChoices(actorId: string) {
    return listProductChoices(this.dependencies, actorId);
  }

  /** The person card: every block answers on its own; see `readPerson`. */
  readPerson(actorId: string, accountId: unknown) {
    return readPerson(this.dependencies, actorId, accountId);
  }

  /** The Accounts a search text names, at most `limit`, after the right is checked. */
  private async findSearchCandidates(
    actorId: string,
    input: { readonly query: unknown; readonly limit?: unknown },
  ) {
    // The right comes first: another role is refused whatever it sends.
    const refused = await authorizePeopleRead(this.dependencies, actorId);
    if (refused !== undefined) return refused;
    const parsed = searchInputSchema.safeParse(input);
    const term = parsed.success
      ? parsePersonSearchTerm(parsed.data.query)
      : undefined;
    if (!parsed.success || term === undefined)
      return failure("invalid_request");
    return findCandidates(
      this.dependencies,
      term,
      parsed.data.limit ?? PEOPLE_SEARCH_LIMIT,
    );
  }
}
