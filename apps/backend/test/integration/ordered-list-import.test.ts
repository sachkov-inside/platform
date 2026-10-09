import { afterAll, beforeAll, expect, test } from "vitest";
import { renderedMaterialBodySchema } from "@inside/material-blocks";

import { convertMarkdown } from "../../../../tools/authoring/markdown.mjs";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("Markdown list starts survive import, persistence, preview and published reading", async () => {
  const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const source = {
    id: "ordered-list-start",
    path: "materials/ordered-list.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const imported = convertMarkdown(
    "5. Fifth\n\n   8. Nested eighth\n   9. Nested ninth\n6. Sixth\n\n- Bullet\n\n1. First\n2. Second",
    {
      sourcePath: source.path,
      sourceId: source.id,
      link: (href) => href,
      image: () => {
        throw new Error("Unexpected image");
      },
    },
  );
  const accepted = materialBodyOperations.accept(imported);
  if (!accepted.ok) throw new Error(JSON.stringify(accepted.error));
  expect(imported.doc.content[0]?.attrs?.["start"]).toBe(5);
  const { authoring, publishedMaterialReader } = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (id) => id === actor },
  });
  const reserved = await authoring.reserveSourceMaterial({ actor, source });
  if (!reserved.ok) throw new Error(reserved.error.code);
  const materialId = reserved.value.materialId;
  const topic = await authoring.createContentCollection({
    actor,
    kind: "topic",
    name: "List starts",
    slug: "list-starts",
    summary: "",
  });
  if (!topic.ok) throw new Error(topic.error.code);
  const saved = await authoring.applySourceMaterial({
    actor,
    source,
    materialId,
    expectedContentVersion: 1,
    idempotencyKey: "import-list-start",
    publicationState: "published",
    primaryVideoId: null,
    metadata: {
      title: "Ordered list starts",
      summary: "Preserved numbering",
      access: "free",
      difficulty: null,
      outcomes: [],
      topicId: topic.value.id,
      formatId: "note",
      tagIds: [],
      seriesIds: [],
    },
    body: accepted.value,
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved.error));
  const loaded = await authoring.loadMaterial({ actor, materialId });
  if (!loaded.ok) throw new Error(loaded.error.code);
  expect(loaded.value.body).toEqual(accepted.value);
  const preview = await authoring.previewMaterial({ actor, materialId });
  if (!preview.ok) throw new Error(preview.error.code);
  if (loaded.value.metadata.slug === null)
    throw new Error("Missing published slug");
  const read = await publishedMaterialReader.read({
    subject: { kind: "anonymous" },
    slug: loaded.value.metadata.slug,
  });
  if (!read.ok || read.value.kind !== "available")
    throw new Error("Reader unavailable");
  for (const body of [preview.value.body, read.value.body]) {
    expect(renderedMaterialBodySchema.parse(body)).toEqual(body);
    expect(body.blocks).toMatchObject([
      {
        kind: "ordered_list",
        start: 5,
        items: [
          [{ kind: "paragraph" }, { kind: "ordered_list", start: 8 }],
          [{ kind: "paragraph" }],
        ],
      },
      { kind: "bullet_list" },
      { kind: "ordered_list" },
    ]);
    expect(body.blocks[1]).not.toHaveProperty("start");
    expect(body.blocks[2]).not.toHaveProperty("start");
  }
});
