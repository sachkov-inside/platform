// @ts-check
import { z } from "zod";

/**
 * Подставные ученики продукта и ручная выдача для вкладки «Ученики» (#1718): HTTP-двойник
 * `GET /admin/products/:productId/holders` и `POST /admin/access/products/issue`, а не проверка
 * прав. Отвечает только за продукт «Архитектура приложения» страницы «Продукты». Первая попытка
 * выдачи аккаунту `failingAccountId` отвечает сбоем зависимости; повтор с той же `sourceRef`
 * выдаёт продукт, как идемпотентная команда Product Access. `POST /__product-learners/reset`
 * возвращает исходных учеников, `GET /__product-learners/commands` отдаёт принятые выдачи.
 */

export const learnersProductId = "c0110000-0000-4000-8000-000000000001";
/** Человек из `people-backend.mjs` с email и без имени: его первая выдача не удаётся. */
export const failingAccountId = "d1210000-0000-4000-8000-000000000003";
/** Ученик без контактов: в чтении людей его нет. */
export const contactlessAccountId = "e1210000-0000-4000-8000-000000000009";

const issueSchema = z
  .object({
    accountId: z.string(),
    productId: z.string(),
    sourceRef: z.string(),
    reason: z.string(),
  })
  .strict();

/**
 * @typedef {{
 *   accountId: string;
 *   access: "active" | "revoked";
 *   firstIssuedAt: string | null;
 *   learning: { readCount: number; totalCount: number; startedAt: string | null; lastActivityAt: string | null };
 *   revision: number;
 * }} Holder
 * @typedef {z.infer<typeof issueSchema>} IssueCommand
 */

/** @returns {Holder[]} */
function initialHolders() {
  return [
    {
      accountId: "d1210000-0000-4000-8000-000000000001",
      access: "active",
      firstIssuedAt: "2026-10-20T09:30:00.000Z",
      learning: {
        readCount: 3,
        totalCount: 5,
        startedAt: "2026-10-20T10:00:00.000Z",
        lastActivityAt: "2026-10-24T18:15:00.000Z",
      },
      revision: 2,
    },
    {
      accountId: contactlessAccountId,
      access: "revoked",
      firstIssuedAt: "2026-09-02T08:00:00.000Z",
      learning: {
        readCount: 0,
        totalCount: 5,
        startedAt: null,
        lastActivityAt: null,
      },
      revision: 3,
    },
  ];
}

let holders = initialHolders();
/** @type {IssueCommand[]} */
let commands = [];
/** @type {Set<string>} */
let failedOnce = new Set();

/** @param {number} status @param {string} code */
function problem(status, code) {
  return { status, value: { code, status } };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function productLearnersRoute(request, url, readBody) {
  if (
    url.pathname === "/__product-learners/reset" &&
    request.method === "POST"
  ) {
    holders = initialHolders();
    commands = [];
    failedOnce = new Set();
    return { status: 200, value: { reset: true } };
  }
  if (url.pathname === "/__product-learners/commands")
    return { status: 200, value: { commands } };

  const list = /^\/admin\/products\/([^/]+)\/holders$/u.exec(url.pathname);
  if (list !== null && request.method === "GET") {
    if (list[1] !== learnersProductId) return null;
    if (request.headers.authorization === undefined)
      return problem(401, "invalid_proof");
    const accountIds = url.searchParams
      .getAll("accountIds")
      .flatMap((value) => value.split(","))
      .filter((value) => value !== "")
      .map((value) => value.toLowerCase());
    const access = url.searchParams.get("access");
    const items = holders.filter(
      (holder) =>
        (accountIds.length === 0 || accountIds.includes(holder.accountId)) &&
        (access === null || holder.access === access),
    );
    return { status: 200, value: { items, nextCursor: null } };
  }

  if (
    url.pathname !== "/admin/access/products/issue" ||
    request.method !== "POST"
  )
    return null;
  if (request.headers.authorization === undefined)
    return problem(401, "invalid_proof");
  const command = issueSchema.parse(JSON.parse(await readBody(request)));
  if (command.productId !== learnersProductId) return problem(404, "not_found");
  commands.push(command);
  if (
    command.accountId === failingAccountId &&
    !failedOnce.has(command.sourceRef)
  ) {
    failedOnce.add(command.sourceRef);
    return problem(503, "dependency_unavailable");
  }
  const current = holders.find(
    (holder) => holder.accountId === command.accountId,
  );
  if (current !== undefined)
    return {
      status: 200,
      value: {
        ok: true,
        outcome: current.access === "active" ? "already_active" : "revoked",
        value: {
          accountId: current.accountId,
          productId: learnersProductId,
          access: current.access,
          firstIssuedAt: current.firstIssuedAt,
          revision: current.revision,
        },
      },
    };
  /** @type {Holder} */
  const holder = {
    accountId: command.accountId,
    access: "active",
    firstIssuedAt: "2026-10-27T12:00:00.000Z",
    learning: {
      readCount: 0,
      totalCount: 5,
      startedAt: null,
      lastActivityAt: null,
    },
    revision: 1,
  };
  holders = [holder, ...holders];
  return {
    status: 200,
    value: {
      ok: true,
      outcome: "issued",
      value: {
        accountId: holder.accountId,
        productId: learnersProductId,
        access: holder.access,
        firstIssuedAt: holder.firstIssuedAt,
        revision: holder.revision,
      },
    },
  };
}
