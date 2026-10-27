import { describe, expect, it, vi } from "vitest";

import { executeCreateContentCollection } from "@/_pages/content-collections/api/create-content-collection";
import { getContentCollections } from "@/_pages/content-collections/api/get-content-collections";
import { executeSetContentCollectionArchive } from "@/_pages/content-collections/api/set-content-collection-archive";
import { executeUpdateContentCollection } from "@/_pages/content-collections/api/update-content-collection";
import {
  createContentCollectionOperation,
  setContentCollectionArchiveOperation,
  updateContentCollectionOperation,
} from "@/_pages/content-collections/api/content-collections.operation";
import {
  COLLECTION_PAGE_SIZE,
  collectionListHref,
  filterCollections,
  hasCollectionFilters,
  pageOfCollections,
  parseCollectionListQuery,
  presentProductRow,
  presentTopicRow,
  productListColumnIds,
  serializeCollectionListQuery,
  withoutCollectionFilters,
  withoutOpenTopic,
} from "@/_pages/content-collections/model/collection-list";
import {
  parseProductPageTab,
  productPageTabSearch,
} from "@/_pages/content-collections/model/product-page-tabs";
import {
  createContentCollectionResultSchema,
  setContentCollectionArchiveResultSchema,
  updateContentCollectionResultSchema,
} from "@/_pages/content-collections/model/content-collections";

const collectionId = "96500000-0000-4000-8000-000000000001";
const collection = {
  archived: false,
  id: collectionId,
  introduction: null,
  kind: "topic",
  materialCount: 3,
  publishedMaterialCount: 1,
  name: "Platform",
  slug: "platform",
  summary: "Architecture and delivery.",
  version: 2,
} as const;

describe("Content collection web adapters", () => {
  it("keeps mutation result contracts operation-specific", () => {
    expect(
      createContentCollectionResultSchema.safeParse({ kind: "conflict" })
        .success,
    ).toBe(false);
    expect(
      updateContentCollectionResultSchema.safeParse({ kind: "slug_conflict" })
        .success,
    ).toBe(false);
    expect(
      setContentCollectionArchiveResultSchema.safeParse({
        kind: "slug_conflict",
      }).success,
    ).toBe(false);
  });

  it("loads active and archived collections through the protected backend", async () => {
    const request = vi.fn().mockResolvedValue({
      body: [
        collection,
        {
          ...collection,
          archived: true,
          id: "96500000-0000-4000-8000-000000000002",
          slug: "archive",
        },
      ],
      ok: true,
      response: Response.json({}),
    });
    await expect(
      getContentCollections("topic", "token", request),
    ).resolves.toEqual({
      collections: [collection, expect.objectContaining({ archived: true })],
      kind: "ready",
    });
    expect(request).toHaveBeenCalledWith("topic", "token");
  });

  it("reads the Product page fields the backend sends with every collection", async () => {
    // Since #672 each collection carries its page description, presentation and source key.
    const product = {
      ...collection,
      kind: "series",
      page: { heading: "Product" },
      pageRejected: false,
      presentation: "default",
      sourceId: "products/platform",
    } as const;
    const list = vi.fn().mockResolvedValue({
      body: [product],
      ok: true,
      response: Response.json({}),
    });
    await expect(
      getContentCollections("series", "token", list),
    ).resolves.toMatchObject({
      collections: [{ id: collectionId, presentation: "default" }],
      kind: "ready",
    });
    const input = createContentCollectionOperation.input.parse({
      kind: "series",
      name: "Platform",
      slug: "platform",
      summary: "Architecture and delivery.",
    });
    const create = vi.fn().mockResolvedValue({
      body: product,
      ok: true,
      response: Response.json({}),
    });
    await expect(
      executeCreateContentCollection(input, "token", create),
    ).resolves.toMatchObject({
      kind: "saved",
      collection: { id: collectionId },
    });
  });

  it("creates a collection through the focused creation operation", async () => {
    const request = successfulRequest();
    const input = createContentCollectionOperation.input.parse({
      kind: "topic",
      name: "Platform",
      slug: "platform",
      summary: "Architecture and delivery.",
      actor: "untrusted",
    });

    await expect(
      executeCreateContentCollection(input, "token", request),
    ).resolves.toEqual({ kind: "saved", collection });
    expect(request).toHaveBeenCalledWith(
      {
        kind: "topic",
        name: "Platform",
        slug: "platform",
        summary: "Architecture and delivery.",
      },
      "token",
    );
  });

  it("updates immutable-slug metadata and maps optimistic conflicts", async () => {
    const request = successfulRequest();
    await expect(
      executeUpdateContentCollection(metadataInput(), "token", request),
    ).resolves.toEqual({ kind: "saved", collection });
    expect(request).toHaveBeenCalledWith(
      {
        collectionId,
        expectedVersion: 2,
        kind: "topic",
        name: "Platform engineering",
        summary: "Updated summary.",
      },
      "token",
    );

    const conflict = vi.fn().mockResolvedValue({
      ok: false,
      problem: { code: "stale_content_collection_version" },
      response: Response.json({}, { status: 409 }),
    });
    await expect(
      executeUpdateContentCollection(metadataInput(), "token", conflict),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("sends the Product introduction only when its four fields travel together", async () => {
    const withIntroduction = successfulRequest();
    const introduction = {
      audience: "Разработчики, которые впервые выпускают своё приложение.",
      outcome: "Настроить путь от проверок до подтверждённого обновления.",
      prerequisites: "Базовый Git и умение выполнить команду в терминале.",
      scope: "Один проект и один тестовый сервер.",
    };
    await expect(
      executeUpdateContentCollection(
        metadataInput({ introduction }),
        "token",
        withIntroduction,
      ),
    ).resolves.toEqual({ kind: "saved", collection });
    expect(withIntroduction).toHaveBeenCalledWith(
      expect.objectContaining({ introduction }),
      "token",
    );

    // A rename that carries no introduction field must not clear the stored text.
    const withoutIntroduction = successfulRequest();
    await expect(
      executeUpdateContentCollection(
        metadataInput(),
        "token",
        withoutIntroduction,
      ),
    ).resolves.toEqual({ kind: "saved", collection });
    expect(withoutIntroduction.mock.calls[0]?.[0]).not.toHaveProperty(
      "introduction",
    );

    // A partial introduction is a malformed command, not a partial write.
    expect(
      updateContentCollectionOperation.input.safeParse({
        ...metadataBody(),
        introduction: { audience: introduction.audience },
      }).success,
    ).toBe(false);
  });

  it("archives a collection through the focused archive operation", async () => {
    const request = successfulRequest();
    const input = setContentCollectionArchiveOperation.input.parse({
      archived: true,
      collectionId,
      expectedVersion: 2,
      kind: "topic",
    });

    await expect(
      executeSetContentCollectionArchive(input, "token", request),
    ).resolves.toEqual({ kind: "saved", collection });
    expect(request).toHaveBeenCalledWith(
      {
        archived: true,
        collectionId,
        expectedVersion: 2,
        kind: "topic",
      },
      "token",
    );
  });
});

describe("Topics and Products list presentation", () => {
  const topicId = "96500000-0000-4000-8000-000000000009";

  it("reads search, archive filter, page and the open topic from the address", () => {
    expect(
      parseCollectionListQuery(
        new URLSearchParams(
          `search=${encodeURIComponent("Платформа ")}&state=archived&page=3&topic=${topicId}`,
        ),
        "topic",
      ),
    ).toEqual({
      search: "Платформа ",
      state: "archived",
      page: 3,
      topicId,
    });
    // Продукты открываются своей страницей: `?topic=` у них ничего не значит.
    expect(
      parseCollectionListQuery(
        new URLSearchParams(`topic=${topicId}`),
        "series",
      ),
    ).toEqual({ search: "", state: "all", page: 1 });
    // Незнакомые значения дают вид по умолчанию, а не ошибку.
    expect(
      parseCollectionListQuery(
        new URLSearchParams(
          "state=deleted&page=0&topic=not-a-uuid&search=%20%20",
        ),
        "topic",
      ),
    ).toEqual({ search: "", state: "all", page: 1 });
    expect(
      parseCollectionListQuery(
        new URLSearchParams({ search: "x".repeat(400) }),
        "series",
      ).search,
    ).toHaveLength(160);
  });

  it("writes only non-default values back and keeps typed search text", () => {
    expect(
      serializeCollectionListQuery({ search: "", state: "all", page: 1 }),
    ).toBe("");
    const query = {
      search: "Платформа ",
      state: "active",
      page: 2,
      topicId,
    } as const;
    const serialized = serializeCollectionListQuery(query);
    expect(
      parseCollectionListQuery(new URLSearchParams(serialized), "topic"),
    ).toEqual(query);
    expect(
      collectionListHref("/authoring/topics", withoutOpenTopic(query)),
    ).toBe(
      `/authoring/topics?search=${encodeURIComponent("Платформа ").replaceAll("%20", "+")}&state=active&page=2`,
    );
    expect(withoutCollectionFilters(query)).toEqual({
      search: "",
      state: "all",
      page: 1,
      topicId,
    });
    expect(hasCollectionFilters(withoutCollectionFilters(query))).toBe(false);
    expect(hasCollectionFilters({ search: " ", state: "all", page: 1 })).toBe(
      false,
    );
  });

  it("filters the complete list by name and archive state", () => {
    const collections = [
      {
        ...collection,
        id: "96500000-0000-4000-8000-000000000011",
        name: "Платформа",
      },
      {
        ...collection,
        archived: true,
        id: "96500000-0000-4000-8000-000000000012",
        name: "Старая платформа",
      },
      {
        ...collection,
        id: "96500000-0000-4000-8000-000000000013",
        name: "Агенты",
      },
    ];
    const names = (state: "all" | "active" | "archived", search: string) =>
      filterCollections(collections, { search, state, page: 1 }).map(
        ({ name }) => name,
      );
    expect(names("all", " ПЛАТФОРМА ")).toEqual([
      "Платформа",
      "Старая платформа",
    ]);
    expect(names("active", "платформа")).toEqual(["Платформа"]);
    expect(names("archived", "")).toEqual(["Старая платформа"]);
  });

  it("pages the filtered list and clamps a page beyond the last", () => {
    const rows = Array.from({ length: COLLECTION_PAGE_SIZE + 12 }, (_, i) => i);
    expect(pageOfCollections(rows, 1)).toMatchObject({
      page: 1,
      totalPages: 2,
      summary: "1–50 из 62",
    });
    const last = pageOfCollections(rows, 9);
    expect(last).toMatchObject({ page: 2, summary: "51–62 из 62" });
    expect(last.rows).toHaveLength(12);
    expect(pageOfCollections(rows.slice(0, 3), 1)).toEqual({
      rows: [0, 1, 2],
      page: 1,
      totalPages: 1,
      summary: undefined,
    });
    expect(pageOfCollections([], 4)).toMatchObject({ page: 1, totalPages: 1 });
  });

  it("maps a Product row with its real cover, state and published count", () => {
    expect(productListColumnIds).toEqual([
      "name",
      "state",
      "published",
      "home",
    ]);
    const cover = {
      coverId: "96500000-0000-4000-8000-000000000021",
      renditions: [{ height: 540, width: 960 }],
    };
    expect(
      presentProductRow({
        ...collection,
        cover,
        kind: "series",
        materialCount: 9,
        publishedMaterialCount: 7,
      }),
    ).toEqual({
      id: collectionId,
      name: "Platform",
      caption: "/products/platform",
      cover,
      archived: false,
      state: "product.active",
      publishedMaterialCount: 7,
      href: `/authoring/products/${collectionId}`,
    });
    expect(
      presentProductRow({ ...collection, archived: true, kind: "series" }),
    ).toMatchObject({ cover: null, state: "product.archived" });
  });

  it("maps a Topic row with published out of all materials", () => {
    expect(presentTopicRow(collection)).toEqual({
      id: collectionId,
      name: "Platform",
      caption: "/platform",
      archived: false,
      state: "topic.active",
      publishedMaterialCount: 1,
      materialCount: 3,
      materials: "1 из 3",
    });
    expect(presentTopicRow({ ...collection, archived: true }).state).toBe(
      "topic.archived",
    );
  });

  it("reads the Product page tab from the address and falls back to the programme", () => {
    expect(parseProductPageTab("description")).toBe("description");
    expect(parseProductPageTab("artifacts")).toBe("artifacts");
    expect(parseProductPageTab("settings")).toBe("settings");
    expect(parseProductPageTab("sales")).toBe("program");
    expect(parseProductPageTab(null)).toBe("program");
    expect(productPageTabSearch("", "description")).toBe("?tab=description");
    expect(productPageTabSearch("?tab=description&x=1", "program")).toBe(
      "?x=1",
    );
    expect(productPageTabSearch("?tab=settings", "program")).toBe("");
  });
});

function metadataBody(): Record<string, unknown> {
  return {
    collectionId,
    expectedVersion: 2,
    kind: "topic",
    name: "Platform engineering",
    summary: "Updated summary.",
  };
}

function metadataInput(extra: Record<string, unknown> = {}) {
  return updateContentCollectionOperation.input.parse({
    ...metadataBody(),
    ...extra,
  });
}

function successfulRequest() {
  return vi.fn().mockResolvedValue({
    body: collection,
    ok: true,
    response: Response.json({}),
  });
}
