import { z } from "zod";

export const productArtifactAccessSchema = z.enum(["free", "closed"]);
export type ProductArtifactAccess = z.infer<typeof productArtifactAccessSchema>;

export const productArtifactSchema = z
  .object({
    access: productArtifactAccessSchema,
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
    productIds: z.array(z.uuid()),
    materialIds: z.array(z.uuid()),
    origin: z.enum(["authoring", "platform"]),
    purpose: z.string(),
    sourceId: z.string().nullable(),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();

export type ProductArtifact = z.infer<typeof productArtifactSchema>;

export const productArtifactListSchema = z
  .object({ artifacts: z.array(productArtifactSchema) })
  .strict();

export const productArtifactListStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      artifacts: z.array(productArtifactSchema),
      kind: z.literal("ready"),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["error", "not_found", "unauthorized"]),
      reference: z.string().optional(),
    })
    .strict(),
]);

export type ProductArtifactListState = z.infer<
  typeof productArtifactListStateSchema
>;

/** One wording per refusal, shared by the BFF and the browser adapter. */
export const ARTIFACT_TOO_LARGE = "Файл больше допустимого размера.";
export const ARTIFACT_NOT_ACCEPTED =
  "Такой файл нельзя приложить: он выглядит как программа или скрипт.";

export const productArtifactMutationResultSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({ artifact: productArtifactSchema, kind: z.literal("saved") })
      .strict(),
    z.object({ artifactId: z.uuid(), kind: z.literal("removed") }).strict(),
    z
      .object({ productIds: z.array(z.uuid()), kind: z.literal("referenced") })
      .strict(),
    z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
    z.object({ kind: z.literal("unauthorized") }).strict(),
    z.object({ kind: z.literal("error"), reference: z.string() }).strict(),
  ],
);

export type ProductArtifactMutationResult = z.infer<
  typeof productArtifactMutationResultSchema
>;

/** Human-readable size for the author list, in the product's Russian copy. */
export function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} Б`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024)
    return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} КБ`;
  return `${(kilobytes / 1024).toFixed(1)} МБ`;
}

export function describeArtifactAccess(access: ProductArtifactAccess): string {
  return access === "free" ? "Доступен всем" : "Только участникам";
}

export function describeArtifactContent(artifact: ProductArtifact): string {
  return artifact.content.kind === "file"
    ? `${artifact.content.filename} · ${formatArtifactSize(artifact.content.size)}`
    : artifact.content.externalUrl;
}

/** «в 1 руководстве» / «в 4 руководствах» in the reader's own language. */
export function productsInWords(count: number): string {
  const lastTwo = count % 100;
  const singular = count % 10 === 1 && lastTwo !== 11;
  return `${String(count)} ${singular ? "продукте" : "продуктах"}`;
}
