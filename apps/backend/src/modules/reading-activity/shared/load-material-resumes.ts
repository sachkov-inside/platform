import { randomUUID } from "node:crypto";
import type { ContentAccess, Subject } from "../../content-access/index.js";
import type { PublishedMaterialCatalogItemDto } from "../../content-library/index.js";
import type { Videos } from "../../videos/index.js";
import type { ContinueMaterial } from "../features/get-continue-materials/get-continue-materials.js";

/** A missing or unavailable Videos dependency never invents a playback position. */
export async function loadMaterialResumes(dependencies: {
  readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">;
  readonly videos: Pick<Videos, "loadProgressMany">;
}, subject: Extract<Subject, { kind: "account" }>, materials: readonly PublishedMaterialCatalogItemDto[]) {
  const resumes = new Map<string, ContinueMaterial["resume"]>();
  const videoIds = [...new Set(materials.flatMap((item) => item.primaryVideoId === null ? [] : [item.primaryVideoId]))];
  if (videoIds.length === 0) return resumes;
  try {
    const access = await dependencies.contentAccess.checkAvailabilityMany({ subject, operations: videoIds.map((id) => ({ itemId: id, resource: { kind: "video" as const, videoId: id }, action: "play" as const })), enforcementPoint: "personal_home", correlationId: randomUUID() });
    if (!access.ok) return resumes;
    const allowed = access.items.filter((item) => item.availability === "available").map((item) => item.itemId);
    const progress = await dependencies.videos.loadProgressMany({ accountId: subject.accountId, videoIds: allowed });
    if (!progress.ok) return resumes;
    const byId = new Map(progress.value.map((item) => [item.videoId, item]));
    for (const material of materials) {
      const saved = material.primaryVideoId === null ? undefined : byId.get(material.primaryVideoId);
      const duration = material.primaryVideoDurationSeconds;
      if (saved !== undefined && duration !== undefined && saved.positionSeconds > 0) resumes.set(material.materialId, saved.positionSeconds >= duration ? { kind: "reached-end" } : { kind: "position", positionSeconds: saved.positionSeconds });
    }
  } catch { /* Material access remains usable without a resume claim. */ }
  return resumes;
}
