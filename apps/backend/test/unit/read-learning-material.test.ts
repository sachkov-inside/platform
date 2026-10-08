import type { RenderedBlock } from "@inside/material-blocks";
import { describe, expect, it, vi } from "vitest";

import {
  anonymousSubject,
  type ContentAccess,
} from "../../src/modules/content-access/index.js";
import { readLearningMaterial } from "../../src/modules/content-library/features/read-learning-material/read-learning-material.js";
import type { PublishedMaterialReader } from "../../src/modules/materials/index.js";

describe("Learning material reference batches", () => {
  it.each(["unchanged", "revoked", "new-version"] as const)(
    "checks 101 unique references before issuing a body when access is %s",
    async (state) => {
      const blocks: Extract<RenderedBlock, { kind: "file" }>[] = Array.from(
        { length: 101 },
        (_, index) => ({
          kind: "file",
          assetId: `asset-${String(index)}`,
          label: `File ${String(index)}`,
          filename: `file-${String(index)}.txt`,
        }),
      );
      const body = {
        schemaVersion: 1 as const,
        blocks: [
          ...blocks,
          {
            kind: "blockquote" as const,
            content: [
              {
                kind: "file",
                assetId: "asset-0",
                label: "Repeated file",
                filename: "file-0.txt",
              },
            ],
          },
        ],
      };
      const reader: Pick<PublishedMaterialReader, "read"> = {
        read: () =>
          Promise.resolve({
            ok: true,
            value: {
              kind: "available",
              cacheScope: "public",
              body,
              primaryVideo: null,
              projection: {
                materialId: "72000000-0000-4000-8000-000000000001",
                contentVersion: 7,
                slug: "large-lesson",
                title: "Large lesson",
                summary: "101 references",
                access: "free",
                publishedAt: "2026-09-02T00:00:00.000Z",
                primaryVideoId: null,
                difficulty: null,
                outcomes: [],
                cover: null,
                topic: { id: "topic", name: "Topic", slug: "topic" },
                format: { id: "guide", name: "Guide", slug: "guide" },
                tags: [],
                seriesMemberships: [],
              },
            },
          }),
      };
      const checkAvailabilityMany = vi.fn<
        ContentAccess["checkAvailabilityMany"]
      >(({ operations }) =>
        Promise.resolve({
          ok: true,
          items: operations
            .map(({ itemId }) => ({
              itemId,
              availability:
                itemId === "asset-100"
                  ? ("locked" as const)
                  : ("available" as const),
            }))
            .reverse(),
        }),
      );
      const authorize = vi.fn<ContentAccess["authorize"]>(() => {
        expect(
          checkAvailabilityMany.mock.calls.map(
            ([input]) => input.operations.length,
          ),
        ).toEqual([100, 1]);
        const metadata = {
          decisionId: "final-check",
          policyVersion: "content-access-v1" as const,
          decidedAt: "2026-09-02T00:00:00.000Z",
        };
        return Promise.resolve(
          state === "revoked"
            ? { ...metadata, effect: "deny", reason: "membership_required" }
            : {
                ...metadata,
                effect: "allow",
                reason: "public_resource",
                checkedContentVersion: state === "new-version" ? 8 : 7,
              },
        );
      });
      const result = await readLearningMaterial(
        {
          reader,
          contentAccess: {
            checkAvailabilityMany,
            authorize,
            checkProductAccess: () => Promise.resolve({ kind: "open" }),
          },
        },
        { subject: anonymousSubject, slug: "large-lesson" },
      );

      expect(
        checkAvailabilityMany.mock.calls.flatMap(([input]) =>
          input.operations.map(({ itemId }) => itemId),
        ),
      ).toEqual(blocks.map((block) => block.assetId));
      expect(authorize).toHaveBeenCalledExactlyOnceWith({
        subject: anonymousSubject,
        resource: {
          kind: "material",
          materialId: "72000000-0000-4000-8000-000000000001",
        },
        action: "read",
        enforcementPoint: "mcp_material_read",
        correlationId: expect.any(String),
      });
      if (state === "revoked") {
        expect(result).toEqual({
          ok: false,
          error: { code: "material_not_available" },
        });
      } else if (state === "new-version") {
        expect(result).toEqual({
          ok: false,
          error: {
            code: "content_version_mismatch",
            expectedContentVersion: 7,
            currentContentVersion: 8,
          },
        });
      } else {
        if (!result.ok) throw new Error(result.error.code);
        expect(result.value.body).toEqual(body);
        expect(result.value.assets).toEqual(
          blocks.map((block, index) => ({
            assetId: block.assetId,
            kind: "file",
            availability: index === 100 ? "locked" : "available",
            contentIncluded: false,
          })),
        );
      }
    },
  );
});
