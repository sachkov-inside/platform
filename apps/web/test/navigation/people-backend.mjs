// @ts-check

/**
 * The owner's people reads of the navigation suite (#1721): an isolated HTTP fixture in the shape
 * of the Nest contract (`GET /authoring/people/search`, `GET /authoring/people/identities`), not a
 * permission test. Tokens select authored outcomes; who counts as a person, exact email matching
 * and refusals are proven by the backend integration test `people-directory.test.ts`.
 *
 * - `Bearer people-forbidden` gets 403 like an Account without `billing:manage`.
 * - A query `telegram-down` stands for a name search while Telegram cannot answer.
 */
export const people = [
  {
    accountId: "d1210000-0000-4000-8000-000000000001",
    displayName: "Анна Петрова",
    username: "anna_petrova",
    email: "anna.petrova@example.test",
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000002",
    displayName: "Константин Константинопольский-Задунайский",
    username: null,
    email: "konstantin.zadunaisky.long.address@example.test",
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000003",
    displayName: null,
    username: null,
    email: "buyer.only@example.test",
    contactsState: "partial",
  },
];

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @returns {{status: number, value: unknown} | null}
 */
export function peopleRoute(request, url) {
  if (
    request.method !== "GET" ||
    !["/authoring/people/search", "/authoring/people/identities"].includes(
      url.pathname,
    )
  )
    return null;
  const token = request.headers.authorization;
  if (token === undefined)
    return { status: 401, value: { code: "invalid_proof" } };
  if (token === "Bearer people-forbidden")
    return { status: 403, value: { code: "forbidden" } };
  if (url.pathname === "/authoring/people/identities") {
    const ids = (url.searchParams.get("accountIds") ?? "")
      .split(",")
      .map((id) => id.toLowerCase());
    return {
      status: 200,
      value: {
        items: people.filter((person) => ids.includes(person.accountId)),
      },
    };
  }
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  if (query === "") return { status: 400, value: { code: "invalid_request" } };
  if (query === "telegram-down")
    return { status: 200, value: { items: [], nameSearch: "unavailable" } };
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const byIdOrEmail = people.filter(
    (person) => person.accountId === query || person.email === query,
  );
  if (byIdOrEmail.length > 0 || (query.includes("@") && !query.startsWith("@")))
    return {
      status: 200,
      value: { items: byIdOrEmail.slice(0, limit), nameSearch: "available" },
    };
  const text = query.replace(/^@/u, "");
  return {
    status: 200,
    value: {
      items: people
        .filter(
          (person) =>
            (person.displayName ?? "").toLowerCase().includes(text) ||
            (person.username ?? "").toLowerCase().includes(text),
        )
        .slice(0, limit),
      nameSearch: "available",
    },
  };
}
