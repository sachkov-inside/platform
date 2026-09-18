import { test } from "node:test";
import assert from "node:assert/strict";
import { formatProducts, listProducts } from "./products.mjs";

const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

test("the product list shows the permanent key, address, look, Home pin and lessons", async () => {
  const responses = {
    "/authoring/collections?kind=guide": [
      { id: uuid(1), slug: "working-with-agents", name: "AI-first разработка", archived: false, materialCount: 108, sourceId: "inside-content:working-with-agents", presentation: "ai-first-process", page: { card: null, blocks: [] }, pageRejected: false, summary: "", version: 3 },
      { id: uuid(2), slug: "platform-guide", name: "Ручной продукт", archived: true, materialCount: 0, sourceId: null, presentation: "default", page: null, pageRejected: false, summary: "", version: 1 },
    ],
    "/authoring/home-pin": { seriesId: uuid(1), version: 4 },
  };
  const products = await listProducts(async (path) => responses[path]);
  assert.deepEqual(products, [
    { sourceId: "inside-content:working-with-agents", id: uuid(1), slug: "working-with-agents", name: "AI-first разработка", presentation: "ai-first-process", pinnedOnHome: true, lessons: 108, archived: false, page: "stored" },
    { sourceId: null, id: uuid(2), slug: "platform-guide", name: "Ручной продукт", presentation: "default", pinnedOnHome: false, lessons: 0, archived: true, page: "none" },
  ]);
  assert.deepEqual(formatProducts(products).split("\n"), [
    "sourceId                            slug                 presentation      page    home    lessons  name",
    "inside-content:working-with-agents  working-with-agents  ai-first-process  stored  pinned  108      AI-first разработка",
    "— (Platform)                        platform-guide       default           none            0        Ручной продукт (archived)",
  ]);
});

test("a response of another shape stops the listing", async () => {
  await assert.rejects(listProducts(async (path) => (path === "/authoring/home-pin" ? { seriesId: null } : [{ id: "not-a-uuid" }])));
});
