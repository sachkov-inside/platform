// @ts-check
import { z } from "zod";

// Command bodies the web BFF sends; a malformed body fails the request.
const commandSchema = z
  .object({
    accountId: z.string(),
    productId: z.string(),
    sourceRef: z.string().optional(),
    reason: z.string().optional(),
    expectedRevision: z.number().optional(),
  })
  .passthrough();

/**
 * The owner's people reads and access actions of the navigation suite (#1721): an isolated HTTP
 * fixture in the shape of the Nest contract, not a permission test. It answers
 * `GET /authoring/people/search`, `/identities`, `/product-choices`, the list `GET /authoring/people`,
 * the card `GET /authoring/people/{accountId}` and the Product Access commands
 * `POST /admin/access/products/{issue,preview-revoke,revoke,restore}` over one in-memory state.
 * Tokens select authored outcomes; who counts as a person, exact email matching, the access rules
 * and refusals are proven by the backend integration tests (`people-directory.test.ts`,
 * `product-access-http.test.ts`).
 *
 * - `Bearer people-forbidden` gets 403 like an Account without `billing:manage`.
 * - `Bearer people-empty` sees a directory without people.
 * - `Bearer people-unavailable` gets 503 `dependency_unavailable` for the list and the card.
 * - A query `telegram-down` stands for a name search while Telegram cannot answer.
 * - `POST /__people/reset` restores the state; `POST /__people/bump` with `{accountId, productId}`
 *   changes one access revision as another session would, to provoke `revision_conflict`.
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

/** The Product choices: two current Products, one more and an archived one. */
export const peopleProducts = [
  {
    productId: "c0110000-0000-4000-8000-000000000101",
    name: "AI Engineering: агенты в работе",
    archived: false,
  },
  {
    productId: "c0110000-0000-4000-8000-000000000102",
    name: "Архитектура приложения",
    archived: false,
  },
  {
    productId: "c0110000-0000-4000-8000-000000000103",
    name: "Инженерная практика",
    archived: false,
  },
  {
    productId: "c0110000-0000-4000-8000-000000000104",
    name: "Агенты для команды (поток 2025)",
    archived: true,
  },
];
const [aiProduct, architectureProduct, practiceProduct] = peopleProducts;
const ownerActor = {
  kind: "person",
  accountId: "d1210000-0000-4000-8000-0000000000ff",
  label: "Кирилл Сачков",
};
const firstNames = [
  "Мария Соколова",
  "Дмитрий Иванов",
  "Елена Кузнецова",
  "Алексей Смирнов",
  "Ольга Попова",
  "Сергей Васильев",
];

/** Every person of the list: the three named ones first, then a long tail for paging. */
const directory = [
  ...people,
  ...Array.from({ length: 27 }, (_, index) => ({
    accountId: `d1210000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    displayName: `${firstNames[index % firstNames.length] ?? "Человек"} ${String(index + 1)}`,
    username: index % 3 === 0 ? null : `learner_${String(index + 1)}`,
    email: index % 2 === 0 ? `learner${String(index + 1)}@example.test` : null,
    contactsState: "complete",
  })),
].map((person, index) => ({
  ...person,
  telegram: person.username === null ? "not_linked" : "linked",
  // deterministic-test-allow wall-clock: fixed instants derived from a literal epoch, not the clock.
  registeredAt: new Date(
    Date.UTC(2026, 9, 20, 9) - index * 86_400_000,
  ).toISOString(),
  lastActivityAt:
    index % 4 === 3
      ? null
      : new Date(Date.UTC(2026, 9, 26, 15) - index * 3_600_000).toISOString(),
}));

/** @typedef {{access: "active"|"revoked", revision: number, origin: string, firstIssuedAt: string, history: object[]}} AccessRecord */

/** @returns {Map<string, AccessRecord>} */
function initialAccess() {
  /** @type {Map<string, AccessRecord>} */
  const records = new Map();
  /** @param {string} accountId @param {string} productId @param {"active"|"revoked"} state @param {string} origin */
  const put = (accountId, productId, state, origin) => {
    const issued = {
      kind:
        origin === "paid"
          ? "purchase"
          : origin === "course_activation"
            ? "activation"
            : "manual_issue",
      at: "2026-09-02T08:15:00.000Z",
      actor: origin === "manual" ? ownerActor : { kind: "system" },
      reason: origin === "manual" ? "Подарок" : null,
    };
    records.set(`${accountId}:${productId}`, {
      access: state,
      revision: state === "active" ? 1 : 2,
      origin,
      firstIssuedAt: issued.at,
      history:
        state === "active"
          ? [issued]
          : [
              {
                kind: "revoke",
                at: "2026-10-01T12:40:00.000Z",
                actor: ownerActor,
                reason: "Возврат оплаты",
              },
              issued,
            ],
    });
  };
  const [anna, konstantin] = people;
  put(anna?.accountId ?? "", aiProduct?.productId ?? "", "active", "paid");
  put(
    anna?.accountId ?? "",
    architectureProduct?.productId ?? "",
    "revoked",
    "manual",
  );
  put(
    konstantin?.accountId ?? "",
    aiProduct?.productId ?? "",
    "active",
    "course_activation",
  );
  directory.slice(3).forEach((person, index) => {
    const product = peopleProducts[index % 3];
    put(
      person.accountId,
      product?.productId ?? "",
      index % 5 === 4 ? "revoked" : "active",
      ["paid", "manual", "course_activation", "legacy"][index % 4] ?? "paid",
    );
  });
  return records;
}

let access = initialAccess();
/** sourceRef → product of the first manual issue that used it. */
/** @type {Map<string, string>} */
let sources = new Map();

/** @param {string} accountId */
function productsOf(accountId) {
  return peopleProducts.flatMap((product) => {
    const record = access.get(`${accountId}:${product.productId}`);
    return record === undefined ? [] : [{ product, record }];
  });
}

/** @param {(typeof directory)[number]} person */
function listItem(person) {
  return {
    accountId: person.accountId,
    displayName: person.displayName,
    username: person.username,
    email: person.email,
    contactsState: person.contactsState,
    telegram: person.telegram,
    registeredAt: person.registeredAt,
    lastActivityAt: person.lastActivityAt,
    products: productsOf(person.accountId)
      .map(({ product, record }) => ({
        productId: product.productId,
        name: product.name,
        access: record.access,
        origin: record.origin,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru")),
  };
}

/** @param {URL} url */
function listPeople(url) {
  const text = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  const productId = url.searchParams.get("productId");
  const origin = url.searchParams.get("origin");
  const state = url.searchParams.get("state");
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const offset = Number((url.searchParams.get("cursor") ?? "o:0").slice(2));
  const nameSearch = text === "telegram-down" ? "unavailable" : "available";
  const matches = directory.filter((person) => {
    if (text === "telegram-down") return false;
    if (text !== "") {
      const byId = person.accountId === text;
      const byEmail = person.email === text;
      const name = text.replace(/^@/u, "");
      const byName =
        !text.includes("@") || text.startsWith("@")
          ? (person.displayName ?? "").toLowerCase().includes(name) ||
            (person.username ?? "").toLowerCase().includes(name)
          : false;
      if (!byId && !byEmail && !byName) return false;
    }
    return (
      (productId === null && origin === null && state === null) ||
      productsOf(person.accountId).some(
        ({ product, record }) =>
          (productId === null || product.productId === productId) &&
          (origin === null || record.origin === origin) &&
          (state === null || record.access === state),
      )
    );
  });
  const page = matches.slice(offset, offset + limit);
  return {
    items: page.map(listItem),
    total: matches.length,
    nextCursor:
      offset + limit < matches.length ? `o:${String(offset + limit)}` : null,
    nameSearch,
  };
}

/** @param {(typeof directory)[number]} person */
function card(person) {
  const [anna, konstantin] = people;
  const products = productsOf(person.accountId).map(({ product, record }) => ({
    productId: product.productId,
    name: product.name,
    access: record.access,
    revision: record.revision,
    firstIssuedAt: record.firstIssuedAt,
    origin: record.origin,
    history: record.history,
  }));
  const header = {
    accountId: person.accountId,
    displayName: person.displayName,
    username: person.username,
    email: person.email,
    contactsState: person.contactsState,
    registeredAt: person.registeredAt,
    telegramUrl:
      person.username === null ? null : `https://t.me/${person.username}`,
  };
  // The second named person shows every block that failed on its own.
  if (person.accountId === konstantin?.accountId)
    return {
      person: header,
      products: { state: "ready", items: products },
      payments: { state: "unavailable" },
      learning: { state: "unavailable" },
      submissions: { state: "forbidden" },
      telegram: { state: "unavailable" },
      waitlists: { state: "unavailable" },
    };
  const rich = person.accountId === anna?.accountId;
  return {
    person: header,
    products: { state: "ready", items: products },
    payments: {
      state: "ready",
      items: rich
        ? [
            {
              paymentId: "e1210000-0000-4000-8000-000000000001",
              productId: aiProduct?.productId ?? null,
              productName: aiProduct?.name ?? null,
              amountKopecks: 1_499_000,
              state: "confirmed",
              createdAt: "2026-09-02T08:14:00.000Z",
              paymentLinkId: "f1210000-0000-4000-8000-000000000001",
            },
            {
              paymentId: "e1210000-0000-4000-8000-000000000002",
              productId: architectureProduct?.productId ?? null,
              productName: architectureProduct?.name ?? null,
              amountKopecks: 990_000,
              state: "failed",
              createdAt: "2026-08-28T19:02:00.000Z",
              paymentLinkId: null,
            },
          ]
        : [],
    },
    learning: {
      state: "ready",
      items: rich
        ? [
            {
              productId: aiProduct?.productId ?? "",
              name: aiProduct?.name ?? "",
              startedAt: "2026-09-03T10:00:00.000Z",
              progress: {
                state: "measured",
                read: 12,
                total: 40,
                lastActivityAt: "2026-10-26T18:20:00.000Z",
              },
            },
          ]
        : [],
    },
    submissions: {
      state: "ready",
      items: rich
        ? [
            {
              productId: aiProduct?.productId ?? "",
              count: 3,
              lastSubmittedAt: "2026-10-25T11:05:00.000Z",
              lastTaskCode: "agent-review",
            },
          ]
        : [],
    },
    telegram: {
      state: "ready",
      link: person.telegram,
      membership: rich ? "member" : "unknown",
      restriction: rich ? "none" : "unknown",
      marketing: rich ? "stopped" : "unknown",
      observedAt: rich ? "2026-10-26T09:00:00.000Z" : null,
    },
    waitlists: {
      state: "ready",
      items: rich
        ? [
            {
              productId: practiceProduct?.productId ?? "",
              productName: practiceProduct?.name ?? null,
              intakeName: "Поток весна 2027",
              active: true,
              joinedAt: "2026-10-10T07:30:00.000Z",
            },
          ]
        : [],
    },
  };
}

/** @param {string} code @param {number} status */
function problem(code, status) {
  return {
    status,
    value: { code, status, title: "Product access operation failed" },
  };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
async function accessCommand(request, url, readBody) {
  const command =
    /^\/admin\/access\/products\/(issue|preview-revoke|revoke|restore)$/u.exec(
      url.pathname,
    )?.[1];
  if (command === undefined || request.method !== "POST") return null;
  const input = commandSchema.parse(JSON.parse(await readBody(request)));
  const key = `${String(input.accountId)}:${String(input.productId)}`;
  const record = access.get(key);
  const view = () => {
    const current = access.get(key);
    return {
      accountId: input.accountId,
      productId: input.productId,
      firstIssuedAt: current?.firstIssuedAt ?? null,
      access: current?.access ?? "active",
      revision: current?.revision ?? 1,
    };
  };
  if (command === "issue") {
    const used = sources.get(input.sourceRef ?? "");
    if (used !== undefined && used !== input.productId)
      return problem("operation_conflict", 409);
    sources.set(input.sourceRef ?? "", input.productId);
    if (record !== undefined)
      return {
        status: 200,
        value: {
          ok: true,
          outcome: record.access === "active" ? "already_active" : "revoked",
          value: view(),
        },
      };
    const at = "2026-10-27T10:00:00.000Z";
    access.set(key, {
      access: "active",
      revision: 1,
      origin: "manual",
      firstIssuedAt: at,
      history: [
        { kind: "manual_issue", at, actor: ownerActor, reason: input.reason },
      ],
    });
    return {
      status: 200,
      value: { ok: true, outcome: "issued", value: view() },
    };
  }
  if (record === undefined) return problem("not_found", 404);
  if (command === "preview-revoke") {
    const others = productsOf(String(input.accountId)).filter(
      ({ product, record: other }) =>
        product.productId !== input.productId && other.access === "active",
    );
    return {
      status: 200,
      value: {
        ok: true,
        value: {
          accountId: input.accountId,
          productId: input.productId,
          revision: record.revision,
          affectedCount: record.access === "active" ? 1 : 0,
          affected:
            record.access === "active"
              ? [
                  {
                    source: record.origin,
                    capabilities: [`product:${String(input.productId)}`],
                    validUntil: null,
                  },
                ]
              : [],
          community:
            record.access === "active" && others.length === 0
              ? "closes"
              : "remains",
        },
      },
    };
  }
  if (record.revision !== input.expectedRevision)
    return problem("revision_conflict", 409);
  record.access = command === "revoke" ? "revoked" : "active";
  record.revision += 1;
  record.history = [
    {
      kind: command,
      at: "2026-10-27T10:05:00.000Z",
      actor: ownerActor,
      reason: input.reason,
    },
    ...record.history,
  ];
  return { status: 200, value: { ok: true, value: view() } };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function peopleRoute(request, url, readBody) {
  if (url.pathname === "/__people/reset" && request.method === "POST") {
    access = initialAccess();
    sources = /** @type {Map<string, string>} */ (new Map());
    return { status: 200, value: { reset: true } };
  }
  if (url.pathname === "/__people/bump" && request.method === "POST") {
    const input = commandSchema.parse(JSON.parse(await readBody(request)));
    const record = access.get(
      `${String(input.accountId)}:${String(input.productId)}`,
    );
    if (record === undefined)
      return { status: 404, value: { code: "not_found" } };
    record.revision += 1;
    return { status: 200, value: { revision: record.revision } };
  }
  const isPeople =
    url.pathname === "/authoring/people" ||
    url.pathname.startsWith("/authoring/people/") ||
    url.pathname.startsWith("/admin/access/products/");
  if (!isPeople) return null;
  const token = request.headers.authorization;
  if (token === undefined)
    return { status: 401, value: { code: "invalid_proof" } };
  if (token === "Bearer people-forbidden")
    return { status: 403, value: { code: "forbidden" } };
  const command = await accessCommand(request, url, readBody);
  if (command !== null) return command;
  if (request.method !== "GET") return null;
  if (url.pathname === "/authoring/people/product-choices")
    return { status: 200, value: { items: peopleProducts } };
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
  if (url.pathname === "/authoring/people/search") return search(url);
  if (token === "Bearer people-unavailable")
    return { status: 503, value: { code: "dependency_unavailable" } };
  if (url.pathname === "/authoring/people") {
    if (token === "Bearer people-empty")
      return {
        status: 200,
        value: {
          items: [],
          total: 0,
          nextCursor: null,
          nameSearch: "available",
        },
      };
    return { status: 200, value: listPeople(url) };
  }
  const accountId = /^\/authoring\/people\/([^/]+)$/u.exec(url.pathname)?.[1];
  const person = directory.find((entry) => entry.accountId === accountId);
  if (person === undefined)
    return { status: 404, value: { code: "not_found" } };
  return { status: 200, value: card(person) };
}

/** @param {URL} url */
function search(url) {
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
