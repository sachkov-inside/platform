// @ts-check
import { authoringScenario } from "../../../../scenarios/authoring.mjs";
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
 *   sourceId?: string;
 *   summary: string;
 *   version: number;
 * }} Collection
 */

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

/** @returns {Collection[]} */
function initialCollections() {
  return [
    collection({
      id: authoringScenario.products.architecture.id,
      kind: "product",
      name: authoringScenario.products.architecture.name,
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
      id: authoringScenario.products.database.id,
      kind: "product",
      name: authoringScenario.products.database.name,
      slug: "navigation-database",
      holderCount: 37,
    }),
    collection({
      id: authoringScenario.products.legacy.id,
      kind: "product",
      name: authoringScenario.products.legacy.name,
      slug: "navigation-legacy",
      archived: authoringScenario.products.legacy.archived,
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
const pinnedProductId = authoringScenario.products.architecture.id;

const orderProductId = "c0110000-0000-4000-8000-000000000053";
const orderMaterialId = "c0110000-0000-4000-8000-000000000101";
const chapterIds = [
  "c0110000-0000-4000-8000-000000000051",
  "c0110000-0000-4000-8000-000000000052",
];
function createOrderScenario() {
  return {
    version: "a".repeat(64),
    writes: /** @type {string[]} */ ([]),
    selections: new Map(
      chapterIds.map((id) => [id, /** @type {string[]} */ ([])]),
    ),
    pending: false,
    hold: Promise.withResolvers(),
  };
}
let orderScenario = createOrderScenario();

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
  const control = "/__collections/order-version";
  if (url.pathname === control && request.method === "POST") {
    orderScenario.hold.resolve(undefined);
    orderScenario = createOrderScenario();
    collections.push(
      collection({
        kind: "product",
        slug: "imported-version-check",
        id: orderProductId,
        sourceId: "synthetic-import",
        name: "Редактирование вложений",
      }),
    );
    return { status: 200, value: { ready: true } };
  }
  if (url.pathname === control && request.method === "GET") {
    return {
      status: 200,
      value: { pending: orderScenario.pending, writes: orderScenario.writes },
    };
  }
  if (url.pathname === control && request.method === "DELETE") {
    orderScenario.hold.resolve(undefined);
    collections = collections.filter((entry) => entry.id !== orderProductId);
    return { status: 200, value: {} };
  }
  if (url.pathname === control + "/release" && request.method === "POST") {
    orderScenario.hold.resolve(undefined);
    return { status: 200, value: {} };
  }
  const attachmentPrefix =
    "/authoring/products/" + orderProductId + "/chapters/";
  if (url.pathname.startsWith(attachmentPrefix)) {
    if (request.headers.authorization === undefined)
      return { status: 401, value: { code: "invalid_proof", status: 401 } };
    if (request.method !== "PUT") return { status: 405, value: {} };
    const chapter = chapterIds.find(
      (id) => url.pathname === attachmentPrefix + id + "/attachments",
    );
    if (chapter === undefined) return { status: 404, value: {} };
    const parsed = z
      .object({
        expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
        materialIds: z.array(z.uuid()),
      })
      .safeParse(
        await readBody(request)
          .then(JSON.parse)
          .catch(() => null),
      );
    if (!parsed.success)
      return { status: 400, value: { code: "invalid_request", status: 400 } };
    const { expectedOrderVersion, materialIds } = parsed.data;
    orderScenario.writes.push(expectedOrderVersion);
    if (expectedOrderVersion !== orderScenario.version)
      return {
        status: 409,
        value: {
          code: "stale_product_order",
          status: 409,
          currentOrderVersion: orderScenario.version,
        },
      };
    orderScenario.selections.set(chapter, materialIds);
    const saved =
      expectedOrderVersion === "a".repeat(64) ? "b".repeat(64) : "d".repeat(64);
    // The competing write in “a later product order read” happens before the pending GET returns.
    orderScenario.version = saved === "b".repeat(64) ? "c".repeat(64) : saved;
    return {
      status: 200,
      value: { productId: orderProductId, orderVersion: saved },
    };
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
    const scoped = product.id === orderProductId;
    if (scoped && orderScenario.version === "c".repeat(64)) {
      orderScenario.pending = true;
      await orderScenario.hold.promise;
    }
    return {
      status: 200,
      value: {
        archived: product.archived,
        chapters: scoped
          ? chapterIds.map((id, index) => ({
              id,
              name:
                (index === 0 ? "Первая глава" : "Вторая глава") +
                (orderScenario.version === "c".repeat(64) ? " обновлена" : ""),
              ordinal: index + 1,
              summary: "",
              supplementaryMaterialIds: orderScenario.selections.get(id),
            }))
          : [],
        items: [
          {
            materialId: orderMaterialId,
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
        orderVersion: scoped ? orderScenario.version : "a".repeat(64),
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
