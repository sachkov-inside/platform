import { describe, expect, it, vi } from "vitest";

import { executeCreateContentCollection } from "@/_pages/content-collections/api/create-content-collection";
import { getContentCollections } from "@/_pages/content-collections/api/get-content-collections";
import { executeSetContentCollectionArchive } from "@/_pages/content-collections/api/set-content-collection-archive";
import { executeUpdateContentCollection } from "@/_pages/content-collections/api/update-content-collection";
import {
  createContentCollectionResultSchema,
  setContentCollectionArchiveResultSchema,
  updateContentCollectionResultSchema,
} from "@/_pages/content-collections/model/content-collections";

const collectionId = "96500000-0000-4000-8000-000000000001";
const collection = {
  archived: false,
  id: collectionId,
  kind: "topic",
  materialCount: 3,
  name: "Platform",
  slug: "platform",
  summary: "Architecture and delivery.",
  version: 2,
} as const;

describe("Content collection web adapters", () => {
  it("keeps mutation result contracts operation-specific", () => {
    expect(
      createContentCollectionResultSchema.safeParse({ kind: "conflict" }).success,
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
      body: [collection, { ...collection, archived: true, id: "96500000-0000-4000-8000-000000000002", slug: "archive" }],
      ok: true,
      response: Response.json({}),
    });
    await expect(getContentCollections("topic", "token", request)).resolves.toEqual({
      collections: [collection, expect.objectContaining({ archived: true })],
      kind: "ready",
    });
    expect(request).toHaveBeenCalledWith("topic", "token");
  });

  it("creates a collection through the focused creation operation", async () => {
    const request = successfulRequest();
    const formData = new FormData();
    formData.set("kind", "topic");
    formData.set("name", "Platform");
    formData.set("slug", "platform");
    formData.set("summary", "Architecture and delivery.");

    await expect(
      executeCreateContentCollection(formData, "token", request),
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
    const formData = metadataForm();
    await expect(
      executeUpdateContentCollection(formData, "token", request),
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
      executeUpdateContentCollection(metadataForm(), "token", conflict),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("archives a collection through the focused archive operation", async () => {
    const request = successfulRequest();
    const formData = new FormData();
    formData.set("archived", "true");
    formData.set("collectionId", collectionId);
    formData.set("expectedVersion", "2");
    formData.set("kind", "topic");

    await expect(
      executeSetContentCollectionArchive(formData, "token", request),
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

function metadataForm(): FormData {
  const formData = new FormData();
  formData.set("collectionId", collectionId);
  formData.set("expectedVersion", "2");
  formData.set("kind", "topic");
  formData.set("name", "Platform engineering");
  formData.set("summary", "Updated summary.");
  return formData;
}

function successfulRequest() {
  return vi.fn().mockResolvedValue({
    body: collection,
    ok: true,
    response: Response.json({}),
  });
}
