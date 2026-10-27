import { createHash } from "node:crypto";

import { z } from "zod";

import {
  productAccessOriginSchema,
  type ProductAccessOrigin,
} from "../../../account-rights/index.js";
import {
  parsePersonSearchTerm,
  type PersonSearchTerm,
} from "../../domain/person-search-term.js";
import {
  authorizePeopleRead,
  failure,
  findCandidates,
  identifyPeople,
  type NameSearchState,
  type PeopleDirectoryDependencies,
  type PeopleDirectoryResult,
  type PersonIdentity,
} from "../../shared/people-composition.js";
import { byName, readProductNames } from "../../shared/product-names.js";

/** The most people one page returns. */
export const PEOPLE_PAGE_LIMIT = 50;
/** The page size without an explicit `limit`. */
export const PEOPLE_PAGE_DEFAULT_LIMIT = 25;
/** The longest cursor the list accepts; every cursor it issues is far shorter. */
export const PEOPLE_CURSOR_MAX_CHARACTERS = 512;
/**
 * The most Accounts a search term contributes to one list: Telegram's name search answers at
 * most 50 matches, and an address or an ID matches far fewer.
 */
const SEARCH_CANDIDATES_LIMIT = 50;

/** One Product of a person in the list: its access state and how it was first acquired. */
export interface PersonProductSummary {
  readonly productId: string;
  readonly name: string;
  readonly access: "active" | "revoked";
  readonly origin: ProductAccessOrigin;
}

export interface PeopleListItem extends PersonIdentity {
  readonly telegram: "linked" | "not_linked";
  readonly registeredAt: string;
  readonly lastActivityAt: string | null;
  /** Sorted by name. */
  readonly products: readonly PersonProductSummary[];
}

export type ListPeopleResult = PeopleDirectoryResult<{
  readonly items: readonly PeopleListItem[];
  /** Every person matching the search and filters, not only this page. */
  readonly total: number;
  readonly nextCursor: string | null;
  readonly nameSearch: NameSearchState;
}>;

/**
 * `community_failed`: the latest community operation of the Account was rejected, failed or is
 * overdue. `delivery_failed`: a Telegram delivery to the Account has an unknown result, or failed
 * recently. The Overview counts the people of the same Account sets.
 */
export const peopleTelegramFilterSchema = z.enum([
  "community_failed",
  "delivery_failed",
]);

const listInputSchema = z.strictObject({
  query: z.string().optional(),
  productId: z.uuid().toLowerCase().optional(),
  /** The origin of the first acquisition of a Product Access. */
  origin: productAccessOriginSchema.optional(),
  state: z.enum(["active", "revoked"]).optional(),
  /** The Accounts behind one Telegram attention item of the Overview (#1719). */
  telegram: peopleTelegramFilterSchema.optional(),
  cursor: z.string().min(1).max(PEOPLE_CURSOR_MAX_CHARACTERS).optional(),
  limit: z.coerce.number().int().min(1).max(PEOPLE_PAGE_LIMIT).optional(),
});

const cursorSchema = z.strictObject({
  /** Registration instant with the database's microseconds. */
  registeredAt: z.iso.datetime({ precision: 6 }),
  accountId: z.uuid(),
  /** Digest of the search and filters the cursor continues; another scope is refused. */
  scope: z.string().regex(/^[0-9a-f]{32}$/u),
});

interface ListScope {
  readonly term: PersonSearchTerm | undefined;
  readonly productId: string | undefined;
  readonly origin: ProductAccessOrigin | undefined;
  readonly state: "active" | "revoked" | undefined;
  readonly telegram: z.infer<typeof peopleTelegramFilterSchema> | undefined;
}

/**
 * One page of people for the owner (#1721), newest registration first. A search term narrows the
 * list to its candidates; `productId`, `origin` and `state` together narrow it to Accounts holding
 * one Product Access that matches all of them (without `productId`, any Product). `telegram`
 * narrows it to the Accounts behind one Telegram attention item of the Overview (#1719). The
 * total and the cursor keep the same search and filters.
 *
 * Every ID set handed between owners is complete or refused: Telegram Membership, Notifications
 * and Account Rights answer at most 50 000 Accounts each and refuse a larger set, which this read
 * reports as `dependency_unavailable`.
 */
export async function listPeople(
  dependencies: PeopleDirectoryDependencies,
  actorId: string,
  input: unknown,
): Promise<ListPeopleResult> {
  // The right comes first: another role is refused whatever it sends.
  const refused = await authorizePeopleRead(dependencies, actorId);
  if (refused !== undefined) return refused;
  const parsed = listInputSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  const { query, productId, origin, state, telegram, cursor } = parsed.data;
  const term = query === undefined ? undefined : parsePersonSearchTerm(query);
  if (query !== undefined && term === undefined)
    return failure("invalid_request");
  const scope = scopeDigest({ term, productId, origin, state, telegram });
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  if (after === null || (after !== undefined && after.scope !== scope))
    return failure("invalid_request");
  const limit = parsed.data.limit ?? PEOPLE_PAGE_DEFAULT_LIMIT;

  let restrictTo: readonly string[] | undefined;
  let nameSearch: NameSearchState = "available";
  if (term !== undefined) {
    const found = await findCandidates(
      dependencies,
      term,
      SEARCH_CANDIDATES_LIMIT,
    );
    if (!found.ok) return found;
    nameSearch = found.value.nameSearch;
    restrictTo = found.value.accountIds;
  }
  if (productId !== undefined || origin !== undefined || state !== undefined) {
    const holders = await dependencies.access.listAccessAccounts(actorId, {
      ...(productId === undefined ? {} : { productId }),
      ...(origin === undefined ? {} : { origin }),
      ...(state === undefined ? {} : { state }),
    });
    if (!holders.ok)
      return failure(
        holders.error.code === "forbidden"
          ? "forbidden"
          : holders.error.code === "invalid_input"
            ? "invalid_request"
            : "dependency_unavailable",
      );
    const held = new Set(holders.accountIds);
    restrictTo =
      restrictTo === undefined
        ? holders.accountIds
        : restrictTo.filter((id) => held.has(id));
  }
  if (telegram !== undefined) {
    const now = new Date();
    const problems =
      telegram === "community_failed"
        ? await dependencies.community.listProblemAccounts(now)
        : await dependencies.deliveries.listTelegramProblemAccounts(now);
    if (!problems.ok) return failure("dependency_unavailable");
    const problemSet = new Set(problems.accountIds);
    restrictTo =
      restrictTo === undefined
        ? problems.accountIds
        : restrictTo.filter((id) => problemSet.has(id));
  }
  const empty = {
    ok: true,
    value: { items: [], total: 0, nextCursor: null, nameSearch },
  } as const;
  if (restrictTo?.length === 0) return empty;

  const links = await dependencies.telegram.listLinkedAccountIds();
  if (!links.ok) return failure("dependency_unavailable");
  const linkedSet = new Set(links.accountIds);
  const page = await dependencies.directory.listDirectory({
    ...(after === undefined
      ? {}
      : {
          after: {
            registeredAt: after.registeredAt,
            accountId: after.accountId,
          },
        }),
    limit,
    ...(restrictTo === undefined ? {} : { restrictTo }),
    // Only the linked Accounts the list may show travel to Accounts.
    linkedAccountIds:
      restrictTo === undefined
        ? links.accountIds
        : restrictTo.filter((id) => linkedSet.has(id)),
  });
  if (!page.ok) return failure("dependency_unavailable");
  const entries = page.value.items;
  const nextCursor =
    page.value.next === null
      ? null
      : encodeCursor({ ...page.value.next, scope });
  if (entries.length === 0)
    return {
      ok: true,
      value: { items: [], total: page.value.total, nextCursor, nameSearch },
    };

  const ids = entries.map((entry) => entry.accountId);
  const [summaries, activity, identities] = await Promise.all([
    dependencies.access.readAccessSummaries(actorId, ids),
    dependencies.learning.readLastActivity(ids),
    identifyPeople(
      dependencies,
      entries.map((entry) => ({
        accountId: entry.accountId,
        billingEmail: entry.billingEmail,
        billingEmailState: entry.billingEmailState,
        linked: linkedSet.has(entry.accountId),
      })),
    ),
  ]);
  if (!summaries.ok)
    return failure(
      summaries.error.code === "forbidden"
        ? "forbidden"
        : "dependency_unavailable",
    );
  if (!activity.ok) return failure("dependency_unavailable");
  const productIds = [
    ...new Set(
      [...summaries.accounts.values()].flatMap((products) =>
        products.map((product) => product.productId),
      ),
    ),
  ];
  const names = await readProductNames(dependencies, productIds, "listPeople");
  if (names === undefined) return failure("dependency_unavailable");

  return {
    ok: true,
    value: {
      items: entries.map((entry, index): PeopleListItem => {
        const identity = identities[index];
        return {
          accountId: entry.accountId,
          displayName: identity?.displayName ?? null,
          username: identity?.username ?? null,
          email: identity?.email ?? null,
          contactsState: identity?.contactsState ?? "partial",
          telegram: linkedSet.has(entry.accountId) ? "linked" : "not_linked",
          registeredAt: entry.registeredAt.toISOString(),
          lastActivityAt: activity.accounts.get(entry.accountId) ?? null,
          products: (summaries.accounts.get(entry.accountId) ?? [])
            .map((product) => ({
              productId: product.productId,
              name: names.get(product.productId) ?? "",
              access: product.access,
              origin: product.origin,
            }))
            .sort(byName),
        };
      }),
      total: page.value.total,
      nextCursor,
      nameSearch,
    },
  };
}

function scopeDigest(scope: ListScope): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope.term?.kind ?? null,
        scope.term === undefined
          ? null
          : scope.term.kind === "account_id"
            ? scope.term.accountId
            : scope.term.kind === "email"
              ? scope.term.email
              : scope.term.text,
        scope.productId ?? null,
        scope.origin ?? null,
        scope.state ?? null,
        scope.telegram ?? null,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

function encodeCursor(cursor: z.infer<typeof cursorSchema>): string {
  return Buffer.from(
    JSON.stringify({
      registeredAt: cursor.registeredAt,
      accountId: cursor.accountId,
      scope: cursor.scope,
    }),
    "utf8",
  ).toString("base64url");
}

/** `null` is a cursor this list never issued. */
function decodeCursor(cursor: string): z.infer<typeof cursorSchema> | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    // Not a dependency failure: a cursor that is not JSON is a malformed request.
    return null;
  }
  const parsed = cursorSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
