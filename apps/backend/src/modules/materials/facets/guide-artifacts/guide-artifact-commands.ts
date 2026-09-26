import { z } from "zod";

import { guideArtifactAccessSchema } from "./guide-artifacts.js";

// Command schemas of the Guide Artifacts facet: every operation parses its input here first.
export const uuidSchema = z.uuid();
const titleSchema = z.string().trim().min(1).max(200);
const purposeSchema = z.string().trim().max(1000);
const sourceIdSchema = z.string().trim().min(1).max(200);
const externalUrlSchema = z.url({ protocol: /^https?$/u }).max(2048);
// The controller reads the same name, purpose and access rule, so both trim alike.
export const metadataSchema = z
  .object({
    access: guideArtifactAccessSchema,
    purpose: purposeSchema,
    title: titleSchema,
  })
  .strict();
const fileSchema = z
  .object({
    body: z.instanceof(Uint8Array),
    declaredContentType: z.string().min(1).max(255),
    declaredSize: z.number().int().positive(),
    expectedChecksumSha256: z.hash("sha256"),
    filename: z.string().min(1).max(255),
  })
  .strict();

export const createSchema = z.discriminatedUnion("kind", [
  z
    .object({
      actor: uuidSchema,
      file: fileSchema,
      guideId: uuidSchema,
      kind: z.literal("file"),
      metadata: metadataSchema,
    })
    .strict(),
  z
    .object({
      actor: uuidSchema,
      externalUrl: externalUrlSchema,
      guideId: uuidSchema,
      kind: z.literal("link"),
      metadata: metadataSchema,
    })
    .strict(),
]);
export const replaceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      actor: uuidSchema,
      artifactId: uuidSchema,
      file: fileSchema,
      kind: z.literal("file"),
    })
    .strict(),
  z
    .object({
      actor: uuidSchema,
      artifactId: uuidSchema,
      externalUrl: externalUrlSchema,
      kind: z.literal("link"),
    })
    .strict(),
]);
export const updateSchema = z
  .object({
    actor: uuidSchema,
    artifactId: uuidSchema,
    metadata: metadataSchema,
  })
  .strict();
export const archiveSchema = z
  .object({ actor: uuidSchema, archived: z.boolean(), artifactId: uuidSchema })
  .strict();
export const guidesSchema = z
  .object({
    actor: uuidSchema,
    artifactId: uuidSchema,
    guideIds: z.array(uuidSchema).max(50),
  })
  .strict();
export const materialsSchema = z
  .object({
    actor: uuidSchema,
    artifactId: uuidSchema,
    materialIds: z.array(uuidSchema).max(200),
  })
  .strict();
export const removeSchema = z
  .object({ actor: uuidSchema, artifactId: uuidSchema })
  .strict();
export const listSchema = z
  .object({ actor: uuidSchema, guideId: uuidSchema })
  .strict();
export const importSchema = z
  .object({
    actor: uuidSchema,
    artifacts: z
      .array(
        z
          .object({
            access: guideArtifactAccessSchema,
            externalUrl: externalUrlSchema.optional(),
            file: fileSchema.optional(),
            purpose: purposeSchema,
            sourceId: sourceIdSchema,
            title: titleSchema,
          })
          .strict()
          .refine(
            (value) =>
              (value.file === undefined) !== (value.externalUrl === undefined),
            { message: "exactly one of file or externalUrl is required" },
          ),
      )
      .max(200),
    guideId: uuidSchema,
    guideSourceId: sourceIdSchema.optional(),
  })
  .strict();

export const reusableListSchema = z.object({ actor: uuidSchema }).strict();

export type ImportedArtifactSource = z.infer<
  typeof importSchema
>["artifacts"][number];
export type AuthoringImportCommand = z.infer<typeof importSchema>;

export const AUTHORING_ARTIFACT_LIMIT = 200;
export const IMPORT_ARTIFACT_LIMIT = 250;
