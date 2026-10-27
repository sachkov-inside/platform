// @ts-check
import { z } from "zod";

/**
 * Подставные темы и продукты для проверок списков «Темы» и «Продукты» и страницы продукта (#1720).
 * Это HTTP-двойник маршрутов Nest, а не проверка прав: любой токен автора получает тот же состав.
 * `POST /__collections/reset` возвращает исходный состав перед каждой проверкой.
 */

const collectionWriteSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().optional(),
    summary: z.string().optional(),
    archived: z.boolean().optional(),
    introduction: z.unknown().optional(),
  })
  .passthrough();

/**
 * @typedef {{
 *   archived: boolean;
 *   cover: null;
 *   holderCount: number | null;
 *   id: string;
 *   introduction: null | Record<string, string>;
 *   kind: "product" | "topic";
 *   materialCount: number;
 *   publishedMaterialCount: number;
 *   name: string;
 *   slug: string;
 *   summary: string;
 *   version: number;
 * }} Collection
 */

/** @returns {Collection[]} */
function initialCollections() {
  /** @param {Partial<Collection> & Pick<Collection, "id" | "kind" | "name" | "slug">} value */
  const collection = (value) => ({
    archived: false,
    cover: null,
    // Как у backend: число обладателей есть только у продукта, у темы его нет.
    holderCount: value.kind === "product" ? 0 : null,
    introduction: null,
    materialCount: 4,
    publishedMaterialCount: 2,
    summary: "Синтетический состав для проверки переходов.",
    version: 1,
    ...value,
  });
  return [
    collection({
      id: "c0110000-0000-4000-8000-000000000001",
      kind: "product",
      name: "Архитектура приложения",
      slug: "navigation-architecture",
      materialCount: 6,
      publishedMaterialCount: 5,
      holderCount: 1240,
      introduction: {
        audience: "Разработчики, которые выпускают первый сервис.",
        outcome: "Собранный и проверенный релиз.",
        prerequisites: "Git и терминал.",
        scope: "Один сервис и одно окружение.",
      },
    }),
    collection({
      id: "c0110000-0000-4000-8000-000000000002",
      kind: "product",
      name: "Работа с базой данных",
      slug: "navigation-database",
      holderCount: 37,
    }),
    collection({
      id: "c0110000-0000-4000-8000-000000000003",
      kind: "product",
      name: "Прежнее руководство по развёртыванию",
      slug: "navigation-legacy",
      archived: true,
      publishedMaterialCount: 0,
    }),
    collection({
      id: "c0110000-0000-4000-8000-000000000011",
      kind: "topic",
      name: "Инфраструктура",
      slug: "navigation-infrastructure",
      materialCount: 8,
      publishedMaterialCount: 6,
    }),
    collection({
      id: "c0110000-0000-4000-8000-000000000012",
      kind: "topic",
      name: "Продуктовая разработка",
      slug: "navigation-product",
    }),
    collection({
      id: "c0110000-0000-4000-8000-000000000013",
      kind: "topic",
      name: "Старые заметки",
      slug: "navigation-old-notes",
      archived: true,
      materialCount: 2,
      publishedMaterialCount: 1,
    }),
  ];
}

let collections = initialCollections();
const pinnedProductId = "c0110000-0000-4000-8000-000000000001";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function contentCollectionsRoute(request, url, readBody) {
  if (url.pathname === "/__collections/reset" && request.method === "POST") {
    collections = initialCollections();
    return { status: 200, value: { reset: true } };
  }
  const authoring =
    url.pathname === "/authoring/collections" ||
    url.pathname.startsWith("/authoring/collections/") ||
    (url.pathname === "/authoring/home-pin" && request.method === "GET") ||
    /^\/authoring\/products\/[^/]+\/order$/u.test(url.pathname);
  if (!authoring) return null;
  if (request.headers.authorization === undefined)
    return { status: 401, value: { code: "invalid_proof", status: 401 } };

  if (url.pathname === "/authoring/collections" && request.method === "GET") {
    const kind = url.searchParams.get("kind");
    return {
      status: 200,
      value: collections
        .filter((collection) => collection.kind === kind)
        .sort((left, right) => left.name.localeCompare(right.name, "ru")),
    };
  }
  if (url.pathname === "/authoring/home-pin")
    return { status: 200, value: { productId: pinnedProductId, version: 1 } };

  const order = /^\/authoring\/products\/([^/]+)\/order$/u.exec(url.pathname);
  if (order !== null && request.method === "GET") {
    const product = collections.find(({ id }) => id === order[1]);
    if (product === undefined)
      return { status: 404, value: { code: "product_not_found", status: 404 } };
    return {
      status: 200,
      value: {
        archived: product.archived,
        chapters: [],
        items: [
          {
            materialId: "c0110000-0000-4000-8000-000000000101",
            ordinal: 1,
            publicationState: "published",
            title: "Первый шаг программы",
          },
          {
            materialId: "c0110000-0000-4000-8000-000000000102",
            ordinal: 2,
            publicationState: "draft",
            title: "Второй шаг программы",
          },
        ],
        name: product.name,
        orderVersion: "a".repeat(64),
        productId: product.id,
      },
    };
  }

  const write = /^\/authoring\/collections\/([^/]+)(\/archive)?$/u.exec(
    url.pathname,
  );
  if (write !== null && request.method === "PUT") {
    const index = collections.findIndex(({ id }) => id === write[1]);
    const current = collections[index];
    if (current === undefined)
      return { status: 404, value: { code: "collection_not_found" } };
    const input = collectionWriteSchema.parse(
      JSON.parse(await readBody(request)),
    );
    if (input.expectedVersion !== current.version)
      return { status: 409, value: { code: "stale_collection", status: 409 } };
    /** @type {Collection} */
    const next =
      write[2] === undefined
        ? {
            ...current,
            name: input.name ?? current.name,
            summary: input.summary ?? current.summary,
            version: current.version + 1,
          }
        : {
            ...current,
            archived: input.archived ?? current.archived,
            version: current.version + 1,
          };
    collections[index] = next;
    return { status: 200, value: next };
  }
  return null;
}
