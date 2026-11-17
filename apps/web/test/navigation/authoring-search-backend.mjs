// @ts-check
import { authoringScenario } from "../../../../scenarios/authoring.mjs";

import { people } from "./people-backend.mjs";

/**
 * The admin global search of the navigation suite: an isolated HTTP fixture in the shape of the
 * Nest contract (`GET /authoring/search`), not a permission test. Tokens select authored outcomes;
 * group permissions, matching and ordering are proven by the backend integration tests. The
 * «Люди» group comes first (#1721); a query `telegram-down` answers it as `partial`.
 */
const products = [
  {
    archived: authoringScenario.products.architecture.archived,
    id: authoringScenario.products.architecture.id,
    name: authoringScenario.products.architecture.name,
  },
  {
    archived: authoringScenario.products.legacy.archived,
    id: authoringScenario.products.legacy.id,
    name: authoringScenario.products.legacy.name,
  },
];
const materials = [
  {
    id: authoringScenario.reviewMaterial.id,
    publicationState: authoringScenario.reviewMaterial.publicationState,
    title: authoringScenario.reviewMaterial.title,
    topic: authoringScenario.agentTopic.name,
  },
];

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @returns {{status: number, value: unknown} | null}
 */
export function authoringSearchRoute(request, url) {
  if (url.pathname !== "/authoring/search" || request.method !== "GET")
    return null;
  const token = request.headers.authorization;
  if (token === undefined)
    return { status: 401, value: { code: "invalid_proof" } };
  if (token === "Bearer search-forbidden")
    return { status: 403, value: { code: "forbidden" } };
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  if (query === "")
    return { status: 400, value: { code: "invalid_request_shape" } };
  return {
    status: 200,
    value: {
      groups: [
        {
          kind: "people",
          state: "ready",
          partial: query === "telegram-down",
          truncated: false,
          items: people
            .filter(
              (person) =>
                (person.displayName ?? "").toLowerCase().includes(query) ||
                (person.username ?? "").toLowerCase().includes(query) ||
                person.email === query,
            )
            .slice(0, 5),
        },
        {
          kind: "products",
          state: "ready",
          items: products.filter((item) =>
            item.name.toLowerCase().includes(query),
          ),
        },
        {
          kind: "materials",
          state: "ready",
          items: materials.filter((item) =>
            item.title.toLowerCase().includes(query),
          ),
        },
      ],
    },
  };
}
