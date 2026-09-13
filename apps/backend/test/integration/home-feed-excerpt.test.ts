import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = "74000000-0000-4000-8000-000000000001";
const metadata = { title: "Feed excerpt safety", summary: "Public summary", access: "free" as const, topicId: "72000000-0000-4000-8000-000000000002", formatId: "note", tagIds: [], difficulty: null, outcomes: [], seriesIds: [] };
function noteBody(text: string) {
  return { schemaVersion: 1 as const, doc: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "74000000-0000-4000-8000-000000000099" }, content: [{ type: "text", text }] }] } };
}

describe("Home feed public note excerpts", () => {
  let database: TestDatabase;
  beforeAll(async () => { database = await createMigratedTestDatabase(); await seedLocalDevelopment(database.prisma); });
  afterAll(async () => { await database.dispose(); });

  test("returns current free text, bounds long notes and removes text when access closes", async () => {
    const { authoring, contentAccess, publishedMaterialReader } = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
    const created = await authoring.createDraft({ actor, idempotencyKey: "feed-note-draft", metadata, body: noteBody("Short complete note") });
    if (!created.ok) throw new Error(created.error.code);
    let version = created.value.contentVersion;
    const publish = async (text: string, access: "free" | "membership", key: string) => {
      const result = await authoring.saveMaterial({ actor, idempotencyKey: key, materialId: created.value.materialId, expectedContentVersion: version, publicationState: "published", metadata: { ...metadata, access }, body: noteBody(text), primaryVideoId: null, deleteVideoId: null });
      if (!result.ok) throw new Error(result.error.code);
      version = result.value.contentVersion;
    };
    const read = async () => {
      const result = await listPublishedMaterials(publishedMaterialReader, contentAccess, emptyCatalogVideos, { subject: anonymousSubject, q: "Feed excerpt safety", first: 24 });
      if (!result.ok) throw new Error(result.error.code);
      return result.value.items.find((item) => item.materialId === created.value.materialId);
    };
    await publish("Short complete note", "free", "feed-note-short");
    expect(await read()).toMatchObject({ noteExcerpt: { text: "Short complete note", truncated: false } });
    await publish("Новый текст. ".repeat(150), "free", "feed-note-long");
    const long = await read();
    expect(long?.noteExcerpt?.text).toHaveLength(1200);
    expect(long?.noteExcerpt?.truncated).toBe(true);
    expect(long?.noteExcerpt?.text).not.toContain("Short complete note");
    await publish("Private note secret", "membership", "feed-note-closed");
    const closed = await read();
    expect(closed?.availability).toBe("locked");
    expect(closed?.noteExcerpt).toBeUndefined();
    expect(JSON.stringify(closed)).not.toContain("Private note secret");
  });
});
