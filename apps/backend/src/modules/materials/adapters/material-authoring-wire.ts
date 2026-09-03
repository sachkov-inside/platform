import { z } from "zod";

export const uuidWireSchema = z.uuid();
export const materialIdWireSchema = uuidWireSchema;
export const idempotencyKeyWireSchema = z.string().trim().min(1).max(200);
export const contentVersionWireSchema = z.number().int().positive();
export const publicationStateWireSchema = z.enum([
  "draft",
  "published",
  "unpublished",
]);
export const seriesMembershipWireSchema = z
  .object({
    seriesId: uuidWireSchema,
    ordinal: z.number().int().positive(),
  })
  .strict();
const materialMetadataSelectionBaseShape = {
  title: z.string().trim().min(1).max(160).nullable(),
  summary: z.string().trim().min(1).max(500).nullable(),
  access: z.enum(["free", "membership", "workshop"]),
  topicId: uuidWireSchema.nullable(),
  formatId: uuidWireSchema.nullable(),
  tagIds: z.array(uuidWireSchema).max(100),
} as const;

export const materialMetadataSelectionWireSchema = z
  .object({
    ...materialMetadataSelectionBaseShape,
    seriesIds: z.array(uuidWireSchema).max(100),
  })
  .strict();

export const materialMetadataWireSchema = z
  .object({
    ...materialMetadataSelectionBaseShape,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .max(120)
      .nullable(),
    seriesMemberships: z.array(seriesMembershipWireSchema).max(100),
  })
  .strict();
export const materialBodySnapshotWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    doc: z.record(z.string(), z.unknown()),
  })
  .strict();
