import { z } from "zod";
import { contractDigest } from "../../../infrastructure/contracts/canonical-digest.js";
import {
  authoringSourceIdSchema,
  authoringSourceSchema,
} from "./authoring-source.js";

export const practiceIdSchema = authoringSourceIdSchema.regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/u,
);

export { practiceDefinitionSchema } from "./practice-requirements-schema.js";
import type { practiceDefinitionSchema } from "./practice-requirements-schema.js";

export const practiceSourceReferenceSchema = z
  .object({
    materialSourceId: authoringSourceIdSchema,
    materialSourceRevision: z.hash("sha256"),
  })
  .strict();

export const practiceProvenanceSchema = z
  .object({
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
      .max(256),
    commit: z.hash("sha1"),
    path: authoringSourceSchema.shape.path,
  })
  .strict();

export type PracticeDefinition = z.infer<typeof practiceDefinitionSchema>;
export type PracticeSourceReference = z.infer<
  typeof practiceSourceReferenceSchema
>;

export function practiceDefinitionDigest(
  definition: PracticeDefinition,
  sourceReference: PracticeSourceReference,
): string {
  return contractDigest({ definition, sourceReference });
}
