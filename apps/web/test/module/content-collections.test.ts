import { describe, expect, it, vi } from "vitest";

import { getContentCollections } from "@/_pages/content-collections/api/get-content-collections";
import {
  executeContentCollectionMutation,
  type ContentCollectionMutationDependencies,
} from "@/_pages/content-collections/api/mutate-content-collection";

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

  it("submits immutable-slug metadata edits and maps optimistic conflicts", async () => {
    const dependencies = successfulDependencies();
    const formData = new FormData();
    formData.set("action", "update");
    formData.set("collectionId", collectionId);
    formData.set("expectedVersion", "2");
    formData.set("kind", "topic");
    formData.set("name", "Platform engineering");
    formData.set("summary", "Updated summary.");

    await expect(
      executeContentCollectionMutation(formData, "token", dependencies),
    ).resolves.toEqual({ kind: "saved", collection });
    expect(dependencies.update).toHaveBeenCalledWith(
      {
        collectionId,
        expectedVersion: 2,
        kind: "topic",
        name: "Platform engineering",
        summary: "Updated summary.",
      },
      "token",
    );

    const conflictDependencies = {
      ...dependencies,
      update: vi.fn().mockResolvedValue({
        ok: false,
        problem: { code: "stale_content_collection_version" },
        response: Response.json({}, { status: 409 }),
      }),
    };
    await expect(
      executeContentCollectionMutation(formData, "token", conflictDependencies),
    ).resolves.toEqual({ kind: "conflict" });
  });
});

function successfulDependencies(): {
  archive: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} & ContentCollectionMutationDependencies {
  const success = () =>
    Promise.resolve({
      body: collection,
      ok: true as const,
      response: Response.json({}),
    });
  return {
    archive: vi.fn(success),
    create: vi.fn(success),
    update: vi.fn(success),
  };
}
