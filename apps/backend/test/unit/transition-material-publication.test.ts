import { describe, expect, test, vi } from "vitest";

import { assembleTransitionMaterialPublication } from "../../src/modules/materials/features/transition-material-publication/transition-material-publication.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";

const materialId = "97000000-0000-4000-8000-000000000001";

describe("Transition Material publication", () => {
  test("loads the owned current state and delegates one full-state Save internally", async () => {
    const current = {
      body: representativeDocument(),
      contentVersion: 4,
      firstPublishedAt: null,
      materialId,
      metadata: {
        access: "free" as const,
        formatId: null,
        seriesMemberships: [
          { ordinal: 1, seriesId: "97000000-0000-4000-8000-000000000002" },
        ],
        slug: null,
        summary: "Summary",
        tagIds: [],
        title: "Title",
        topicId: null,
      },
      publicationState: "draft" as const,
      publishedAt: null,
    };
    const receipt = {
      contentVersion: 5,
      materialId,
      publicationState: "published" as const,
      publishedAt: "2026-09-01T09:00:00.000Z",
    };
    const loadMaterial = vi.fn().mockResolvedValue({ ok: true, value: current });
    const saveMaterial = vi.fn().mockResolvedValue({ ok: true, value: receipt });
    const transition = assembleTransitionMaterialPublication({
      loadMaterial,
      saveMaterial,
    });

    await expect(
      transition({
        actor: "97000000-0000-4000-8000-000000000003",
        expectedContentVersion: 4,
        idempotencyKey: "publish-97000000-0000-4000-8000-000000000001",
        materialId,
        publicationState: "published",
      }),
    ).resolves.toEqual({ ok: true, value: receipt });
    expect(saveMaterial).toHaveBeenCalledWith({
      actor: "97000000-0000-4000-8000-000000000003",
      body: current.body,
      expectedContentVersion: 4,
      idempotencyKey: "publish-97000000-0000-4000-8000-000000000001",
      materialId,
      metadata: {
        access: "free",
        formatId: null,
        seriesIds: ["97000000-0000-4000-8000-000000000002"],
        summary: "Summary",
        tagIds: [],
        title: "Title",
        topicId: null,
      },
      publicationState: "published",
    });
  });
});
