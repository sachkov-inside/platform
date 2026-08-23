import { describe, expect, test } from "vitest";

import { MaterialRevisionMetadata } from "../../src/modules/materials/domain/material-revision-metadata.js";
import {
  restoreMaterial,
  restoreMaterialRevision,
} from "../../src/modules/materials/domain/material.js";

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

  return {
    id: "93000000-0000-4000-8000-000000000001",
    materialId: "93000000-0000-4000-8000-000000000002",
    metadata: metadata.value,
    body: {
      schemaVersion: 1 as const,
      doc: { type: "doc" },
    },
  };
}

describe("Material", () => {
  test("restores a Material around its immutable current draft", () => {
    const values = revisionValues();
    const revision = restoreMaterialRevision(values);
    const material = restoreMaterial(revision);

    expect(material).toEqual({ id: values.materialId, currentDraft: revision });
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(material)).toBe(true);
  });

  test("rejects a revision that does not belong to a Material", () => {
    const revision = restoreMaterialRevision({ ...revisionValues(), materialId: "" });

    expect(() => restoreMaterial(revision)).toThrow(
      "A MaterialRevision must belong to a Material",
    );
  });
});
