import { describe, expect, test } from "vitest";

import { MaterialRevisionMetadata } from "../../src/modules/materials/domain/material-revision-metadata.js";
import {
  Material,
  materialRevision,
  restoreMaterialRevision,
} from "../../src/modules/materials/domain/material.js";
import {
  materialId,
  materialRevisionId,
} from "../../src/modules/materials/domain/material-identifiers.js";
import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";

function revisionValues() {
  const metadata = MaterialRevisionMetadata.create({
    title: "Material title",
    summary: "Material summary",
    slug: "material-title",
    access: "free",
    topicId: "93000000-0000-4000-8000-000000000003",
    formatId: "93000000-0000-4000-8000-000000000004",
    tagIds: [],
    seriesMemberships: [],
  });
  if (!metadata.ok) {
    throw new Error(metadata.error.code);
  }
  const body = materialBodyOperations.accept(representativeDocument());
  if (!body.ok) {
    throw new Error(body.error.code);
  }
  return {
    id: materialRevisionId("93000000-0000-4000-8000-000000000001"),
    materialId: materialId("93000000-0000-4000-8000-000000000002"),
    metadata: metadata.value,
    body: body.value,
  };
}

describe("MaterialRevision", () => {
  test("restores an immutable revision and restores history as a new revision", () => {
    const source = materialRevision(revisionValues());
    const restored = restoreMaterialRevision(
      source,
      materialRevisionId("93000000-0000-4000-8000-000000000005"),
    );

    expect(restored).toMatchObject({
      id: "93000000-0000-4000-8000-000000000005",
      materialId: source.materialId,
      restoredFromRevisionId: source.id,
      metadata: source.metadata,
      body: source.body,
    });
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(restored)).toBe(true);
  });
});

describe("Material lifecycle", () => {
  const id = materialId("93000000-0000-4000-8000-000000000002");
  const draftId = materialRevisionId("93000000-0000-4000-8000-000000000001");
  const publishedId = materialRevisionId(
    "93000000-0000-4000-8000-000000000006",
  );
  const staleId = materialRevisionId("93000000-0000-4000-8000-000000000009");
  const nextDraftId = materialRevisionId(
    "93000000-0000-4000-8000-000000000007",
  );

  test("advances the current draft only from the expected revision", () => {
    const material = Material.restore({
      id,
      currentDraftRevisionId: draftId,
      currentPublishedRevisionId: publishedId,
    });

    expect(
      material.advanceDraft(staleId, draftId),
    ).toEqual({
      ok: false,
      error: { code: "stale_revision", currentRevisionId: draftId },
    });
    expect(
      material.advanceDraft(draftId, nextDraftId),
    ).toMatchObject({
      ok: true,
      value: {
        currentDraftRevisionId: "93000000-0000-4000-8000-000000000007",
        currentPublishedRevisionId: publishedId,
      },
    });
  });

  test("publishes only the current draft from the expected publication", () => {
    const material = Material.restore({
      id,
      currentDraftRevisionId: draftId,
      currentPublishedRevisionId: publishedId,
    });

    expect(
      material.publishRevision(staleId, publishedId),
    ).toEqual({
      ok: false,
      error: { code: "stale_revision", currentRevisionId: draftId },
    });
    expect(material.publishRevision(draftId, null)).toEqual({
      ok: false,
      error: {
        code: "stale_publication",
        currentPublishedRevisionId: publishedId,
      },
    });
    expect(material.publishRevision(draftId, publishedId)).toMatchObject({
      ok: true,
      value: { currentPublishedRevisionId: draftId },
    });
  });

  test("unpublishes only the expected current publication", () => {
    const material = Material.restore({
      id,
      currentDraftRevisionId: draftId,
      currentPublishedRevisionId: publishedId,
    });

    expect(material.unpublish(draftId)).toEqual({
      ok: false,
      error: {
        code: "stale_publication",
        currentPublishedRevisionId: publishedId,
      },
    });
    expect(material.unpublish(publishedId)).toMatchObject({
      ok: true,
      value: { currentPublishedRevisionId: null },
    });
  });
});
