import { describe, expect, test } from "vitest";

import {
  Material,
  type MaterialSaveTransition,
} from "../../src/modules/materials/domain/material.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";

const firstPublication = new Date("2026-08-27T09:00:00.000Z");
const ordinarySave = new Date("2026-08-27T10:00:00.000Z");

function transition(
  values: Partial<MaterialSaveTransition> = {},
): MaterialSaveTransition {
  return {
    expectedContentVersion: 1,
    publicationState: "published",
    slug: "mutable-material",
    now: firstPublication,
    ...values,
  };
}

describe("Material", () => {
  test("publishes a draft and keeps its publication date during an ordinary live Save", () => {
    const draft = Material.restore({
      id: materialId("93000000-0000-4000-8000-000000000001"),
      slug: "mutable-material",
      publicationState: "draft",
      contentVersion: 1,
      firstPublishedAt: null,
      publishedAt: null,
    });

    const published = draft.save(transition());
    if (!published.ok) {
      throw new Error("expected publication to succeed");
    }
    expect(published.value.publicationState).toBe("published");
    expect(published.value.contentVersion).toBe(2);
    expect(published.value.firstPublishedAt).toEqual(firstPublication);
    expect(published.value.publishedAt).toEqual(firstPublication);

    const liveSave = published.value.save(
      transition({
        expectedContentVersion: 2,
        now: ordinarySave,
      }),
    );
    if (!liveSave.ok) {
      throw new Error("expected live Save to succeed");
    }
    expect(liveSave.value.publicationState).toBe("published");
    expect(liveSave.value.contentVersion).toBe(3);
    expect(liveSave.value.firstPublishedAt).toEqual(firstPublication);
    expect(liveSave.value.publishedAt).toEqual(firstPublication);
  });

  test("allows hard deletion only before the first publication", () => {
    const draft = Material.restore({
      id: materialId("93000000-0000-4000-8000-000000000001"),
      slug: "mutable-material",
      publicationState: "draft",
      contentVersion: 1,
      firstPublishedAt: null,
      publishedAt: null,
    });
    expect(draft.canDelete()).toBe(true);

    const published = draft.save(transition());
    if (!published.ok) {
      throw new Error("expected publication to succeed");
    }
    expect(published.value.canDelete()).toBe(false);

    const unpublished = published.value.save(
      transition({
        expectedContentVersion: 2,
        publicationState: "unpublished",
        now: ordinarySave,
      }),
    );
    if (!unpublished.ok) {
      throw new Error("expected unpublish to succeed");
    }
    expect(unpublished.value.canDelete()).toBe(false);
  });

  test("rejects lifecycle transitions that would erase publication history", () => {
    const published = Material.restore({
      id: materialId("93000000-0000-4000-8000-000000000001"),
      slug: "mutable-material",
      publicationState: "published",
      contentVersion: 4,
      firstPublishedAt: firstPublication,
      publishedAt: firstPublication,
    });

    expect(
      published.save(
        transition({
          expectedContentVersion: 4,
          publicationState: "draft",
          now: ordinarySave,
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_publication_transition",
        currentState: "published",
        targetState: "draft",
      },
    });
  });

  test("rejects a stale Save without advancing the current version", () => {
    const material = Material.restore({
      id: materialId("93000000-0000-4000-8000-000000000001"),
      slug: "mutable-material",
      publicationState: "draft",
      contentVersion: 4,
      firstPublishedAt: null,
      publishedAt: null,
    });

    expect(
      material.save(
        transition({
          expectedContentVersion: 3,
          publicationState: "draft",
          now: ordinarySave,
        }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "stale_content_version", currentContentVersion: 4 },
    });
    expect(material.contentVersion).toBe(4);
  });

  test("preserves the slug after first publication and timestamps each republish", () => {
    const published = Material.restore({
      id: materialId("93000000-0000-4000-8000-000000000001"),
      slug: "mutable-material",
      publicationState: "published",
      contentVersion: 2,
      firstPublishedAt: firstPublication,
      publishedAt: firstPublication,
    });

    expect(
      published.save(
        transition({
          expectedContentVersion: 2,
          publicationState: "published",
          slug: "renamed-material",
          now: ordinarySave,
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: { contentVersion: 3, slug: "mutable-material" },
    });

    const unpublished = published.save(
      transition({
        expectedContentVersion: 2,
        publicationState: "unpublished",
        now: ordinarySave,
      }),
    );
    if (!unpublished.ok) {
      throw new Error("expected unpublish to succeed");
    }
    const republishedAt = new Date("2026-08-27T11:00:00.000Z");
    const republished = unpublished.value.save(
      transition({
        expectedContentVersion: 3,
        now: republishedAt,
      }),
    );
    if (!republished.ok) {
      throw new Error("expected republish to succeed");
    }
    expect(republished.value.publicationState).toBe("published");
    expect(republished.value.contentVersion).toBe(4);
    expect(republished.value.firstPublishedAt).toEqual(firstPublication);
    expect(republished.value.publishedAt).toEqual(republishedAt);
  });
});
