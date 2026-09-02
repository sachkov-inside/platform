import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { videoSchema, type MaterialVideo } from "../model/video";

const readyEnvelopeSchema = z.object({ kind: z.literal("ready"), value: z.unknown() }).strict();
const uploadResponseSchema = z.object({ uploadEndpoint: z.url(), video: videoSchema }).strict();

export type VideoMutationResult<Value> =
  | { readonly kind: "ready"; readonly value: Value }
  | { readonly kind: "unavailable" };

export async function initMaterialVideoUpload(input: {
  readonly access: "free" | "membership";
  readonly byteSize: number;
  readonly filename: string;
  readonly materialId: string;
  readonly submissionId: string;
  readonly title: string;
}): Promise<VideoMutationResult<z.infer<typeof uploadResponseSchema>>> {
  const formData = new FormData();
  formData.set("access", input.access);
  formData.set("byteSize", String(input.byteSize));
  formData.set("filename", input.filename);
  formData.set("materialId", input.materialId);
  formData.set("submissionId", input.submissionId);
  formData.set("title", input.title);
  return parseMutation(
    await requestSameOriginMutation("/api/authoring/material-video-uploads", "POST", formData),
    uploadResponseSchema,
  );
}

export async function attachMaterialVideo(input: {
  readonly access: "free" | "membership";
  readonly materialId: string;
  readonly providerVideoId: string;
}): Promise<VideoMutationResult<MaterialVideo>> {
  const formData = new FormData();
  formData.set("access", input.access);
  formData.set("materialId", input.materialId);
  formData.set("providerVideoId", input.providerVideoId);
  return parseMutation(
    await requestSameOriginMutation("/api/authoring/material-video-attachments", "POST", formData),
    videoSchema,
  );
}

export async function reconcileMaterialVideo(input: {
  readonly videoId: string;
}): Promise<VideoMutationResult<MaterialVideo>> {
  const formData = new FormData();
  formData.set("videoId", input.videoId);
  return parseMutation(
    await requestSameOriginMutation("/api/authoring/material-video-reconciliations", "POST", formData),
    videoSchema,
  );
}

export async function retryMaterialVideoDeletion(input: {
  readonly videoId: string;
}): Promise<VideoMutationResult<MaterialVideo>> {
  const formData = new FormData();
  formData.set("videoId", input.videoId);
  return parseMutation(
    await requestSameOriginMutation("/api/authoring/material-video-deletion-retries", "POST", formData),
    videoSchema,
  );
}

function parseMutation<Schema extends z.ZodType>(
  response: Awaited<ReturnType<typeof requestSameOriginMutation>>,
  schema: Schema,
): VideoMutationResult<z.output<Schema>> {
  if (!response.ok) return { kind: "unavailable" };
  const envelope = readyEnvelopeSchema.safeParse(response.body);
  if (!envelope.success) return { kind: "unavailable" };
  const value = schema.safeParse(envelope.data.value);
  return value.success
    ? { kind: "ready", value: value.data }
    : { kind: "unavailable" };
}
