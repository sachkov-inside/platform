import { randomUUID } from "node:crypto";
import {
  materialBlockChildren,
  type RenderedBlock,
} from "@inside/material-blocks";
import {
  CONTENT_ACCESS_BATCH_SIZE,
  type AccessAvailability,
  type ContentAccess,
  type Subject,
} from "../../../content-access/index.js";
import {
  materialId as checkedMaterialId,
  type PublishedMaterialReader,
} from "../../../materials/index.js";

export async function readLearningMaterial(
  dependencies: {
    readonly reader: Pick<PublishedMaterialReader, "read">;
    readonly contentAccess: ContentAccess;
  },
  query: {
    readonly subject: Subject;
    readonly slug: string;
    readonly expectedContentVersion?: number;
  },
) {
  const { subject, slug, expectedContentVersion } = query;

  const result = await dependencies.reader.read({ subject, slug });
  if (!result.ok) return result;
  const material = result.value;
  if (material.kind !== "available") {
    return {
      ok: false as const,
      error: { code: "material_not_available" },
    };
  }
  const { materialId, contentVersion } = material.projection;
  if (
    expectedContentVersion !== undefined &&
    expectedContentVersion !== contentVersion
  ) {
    return {
      ok: false as const,
      error: {
        code: "content_version_mismatch",
        expectedContentVersion,
        currentContentVersion: contentVersion,
      },
    };
  }
  const assets = new Map<
    string,
    {
      assetId: string;
      kind: "image" | "file";
      presentationAvailable: boolean;
    }
  >();
  function collect(block: RenderedBlock): void {
    if (block.kind === "file" || block.kind === "image") {
      assets.set(block.assetId, {
        assetId: block.assetId,
        kind: block.kind,
        presentationAvailable:
          block.kind === "file"
            ? block.filename !== undefined
            : block.variants !== undefined,
      });
    }
    materialBlockChildren(block).forEach(collect);
  }
  material.body.blocks.forEach(collect);
  const resourceAvailability = new Map<
    string,
    AccessAvailability["availability"]
  >();
  // ContentAccess bounds each availability batch; large lessons preserve every reference.
  const references = [...assets.values()];
  for (
    let start = 0;
    start < references.length;
    start += CONTENT_ACCESS_BATCH_SIZE
  ) {
    const batch = await dependencies.contentAccess.checkAvailabilityMany({
      subject,
      operations: references
        .slice(start, start + CONTENT_ACCESS_BATCH_SIZE)
        .map((asset) => ({
          itemId: asset.assetId,
          resource: { kind: "asset", assetId: asset.assetId },
          action: asset.kind === "file" ? "download" : "read",
        })),
      enforcementPoint: "mcp_material_read",
      correlationId: randomUUID(),
    });
    if (!batch.ok)
      return {
        ok: false as const,
        error: { code: "dependency_unavailable" },
      };
    for (const item of batch.items)
      resourceAvailability.set(item.itemId, item.availability);
  }
  const videoId = material.projection.primaryVideoId;
  const videoAccess =
    videoId !== null && material.primaryVideo?.state === "ready"
      ? await dependencies.contentAccess.authorize({
          subject,
          resource: { kind: "video", videoId },
          action: "play",
          enforcementPoint: "mcp_material_read",
          correlationId: randomUUID(),
        })
      : undefined;
  // Asset/video presentation loading can span a Save or access revocation. Recheck the
  // same version before publishing any body, without claiming an immutable archive.
  const current = await dependencies.contentAccess.authorize({
    subject,
    resource: {
      kind: "material",
      materialId: checkedMaterialId(materialId),
    },
    action: "read",
    enforcementPoint: "mcp_material_read",
    correlationId: randomUUID(),
  });
  if (current.effect !== "allow")
    return {
      ok: false as const,
      error: { code: "material_not_available" },
    };
  if (current.checkedContentVersion !== contentVersion)
    return {
      ok: false as const,
      error: {
        code: "content_version_mismatch",
        expectedContentVersion: contentVersion,
        currentContentVersion: current.checkedContentVersion,
      },
    };
  return {
    ok: true as const,
    value: {
      materialId,
      slug: material.projection.slug,
      title: material.projection.title,
      contentVersion,
      complete: true,
      body: material.body,
      assets: references.map((asset) => ({
        assetId: asset.assetId,
        kind: asset.kind,
        availability: asset.presentationAvailable
          ? (resourceAvailability.get(asset.assetId) ?? "unavailable")
          : "unavailable",
        contentIncluded: false,
      })),
      primaryVideo:
        videoId === null
          ? null
          : {
              videoId,
              availability:
                videoAccess?.effect === "allow" &&
                videoAccess.checkedContentVersion === contentVersion
                  ? "available"
                  : "unavailable",
              presentation: material.primaryVideo,
              contentIncluded: false,
            },
      videoChapters: material.videoChapters ?? [],
    },
  };
}
