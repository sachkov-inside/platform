import "server-only";
import { z } from "zod";
import { publishedMaterialProjectionSchema, toMaterialPreview } from "@/entities/material.model";
import { materialResumeSchema, seriesContinuationProjectionSchema, continuationLabel } from "@/features/reading-progress";
import { requestLearningHome } from "@/shared/api/backend/index.server";
import type { PersonalHomeResult } from "../model/personal-home-contract";
const projection = z.object({
  video: z.object({ material: publishedMaterialProjectionSchema, lastOpenedAt: z.iso.datetime(), resume: materialResumeSchema }).strict().nullable(),
  series: seriesContinuationProjectionSchema.nullable(),
}).strict();
export async function getPersonalHome(accessToken: string): Promise<PersonalHomeResult> {
  try {
    const response = await requestLearningHome(accessToken);
    if (!response.ok) return { kind: response.response.status === 401 ? "hidden" : "unavailable" };
    const parsed = projection.safeParse(response.body);
    if (!parsed.success) return { kind: "unavailable" };
    const { video, series } = parsed.data;
    if (video !== null && (video.material.availability !== "available" || video.resume.kind !== "position")) return { kind: "unavailable" };
    return { kind: "ready", continuation: {
      ...(video === null ? {} : { video: { material: toMaterialPreview(video.material), label: continuationLabel(video.resume) } }),
      ...(series === null || series.continuation === null ? {} : { series: { collection: { ...series.collection, previewItems: series.collection.previewItems.map(toMaterialPreview) }, read: series.read, total: series.total } }),
    } };
  } catch { return { kind: "unavailable" }; }
}
