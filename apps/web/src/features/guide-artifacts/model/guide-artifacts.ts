import { z } from "zod";

export const guideArtifactAccessSchema = z.enum(["free", "membership"]);
export type GuideArtifactAccess = z.infer<typeof guideArtifactAccessSchema>;

export const guideArtifactSchema = z
  .object({
    access: guideArtifactAccessSchema,
    archived: z.boolean(),
    artifactId: z.uuid(),
    content: z.discriminatedUnion("kind", [
      z
        .object({
          contentType: z.string(),
          filename: z.string(),
          kind: z.literal("file"),
          size: z.number().int().positive(),
        })
        .strict(),
      z.object({ externalUrl: z.string(), kind: z.literal("link") }).strict(),
    ]),
    guideIds: z.array(z.uuid()),
    materialIds: z.array(z.uuid()),
    origin: z.enum(["authoring", "platform"]),
    purpose: z.string(),
    sourceId: z.string().nullable(),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();

export type GuideArtifact = z.infer<typeof guideArtifactSchema>;

export const guideArtifactListSchema = z
  .object({ artifacts: z.array(guideArtifactSchema) })
  .strict();

export const guideArtifactListStateSchema = z.discriminatedUnion("kind", [
  z.object({ artifacts: z.array(guideArtifactSchema), kind: z.literal("ready") }).strict(),
  z
    .object({
      kind: z.enum(["error", "not_found", "unauthorized"]),
      reference: z.string().optional(),
    })
    .strict(),
]);

export type GuideArtifactListState = z.infer<typeof guideArtifactListStateSchema>;

/** One wording per refusal, shared by the BFF and the browser adapter. */
export const ARTIFACT_TOO_LARGE = "Файл больше допустимого размера.";
export const ARTIFACT_NOT_ACCEPTED =
  "Такой файл нельзя приложить: он выглядит как программа или скрипт.";

export const guideArtifactMutationResultSchema = z.discriminatedUnion("kind", [
  z.object({ artifact: guideArtifactSchema, kind: z.literal("saved") }).strict(),
  z.object({ artifactId: z.uuid(), kind: z.literal("removed") }).strict(),
  z
    .object({ guideIds: z.array(z.uuid()), kind: z.literal("referenced") })
    .strict(),
  z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("error"), reference: z.string() }).strict(),
]);

export type GuideArtifactMutationResult = z.infer<
  typeof guideArtifactMutationResultSchema
>;

/** Human-readable size for the author list, in the product's Russian copy. */
export function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} Б`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} КБ`;
  return `${(kilobytes / 1024).toFixed(1)} МБ`;
}

export function describeArtifactAccess(access: GuideArtifactAccess): string {
  return access === "free" ? "Доступен всем" : "Только участникам";
}

export function describeArtifactContent(artifact: GuideArtifact): string {
  return artifact.content.kind === "file"
    ? `${artifact.content.filename} · ${formatArtifactSize(artifact.content.size)}`
    : artifact.content.externalUrl;
}

/** «в 1 руководстве» / «в 4 руководствах» in the reader's own language. */
export function guidesInWords(count: number): string {
  const lastTwo = count % 100;
  const singular = count % 10 === 1 && lastTwo !== 11;
  return `${String(count)} ${singular ? "руководстве" : "руководствах"}`;
}
