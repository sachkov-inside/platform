import { z } from "zod";
import {
  practiceDefinitionSchema,
  practiceIdSchema,
  practiceProvenanceSchema,
  practiceSourceReferenceSchema,
} from "../../domain/practice-definition.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export const sourcePracticeSchema = z
  .object({
    practiceId: practiceIdSchema,
    definition: practiceDefinitionSchema,
    sourceReference: practiceSourceReferenceSchema,
    provenance: practiceProvenanceSchema,
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();

export const applySourcePracticeBodySchema = sourcePracticeSchema
  .extend({
    materialId: z.uuid(),
    expectedContentVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    expectedPracticeVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();

export const practiceImportReceiptSchema = z
  .object({
    practiceId: practiceIdSchema,
    practiceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    definitionDigest: z.hash("sha256"),
    materialId: z.uuid(),
    boundContentVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();

export type PracticeImportError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | { readonly code: "source_mismatch" }
  | { readonly code: "practice_version_conflict" }
  | { readonly code: "idempotency_conflict" }
  | SystemError;
export type PracticeImportReceipt = z.infer<typeof practiceImportReceiptSchema>;
export type ApplySourcePracticeOperation = (
  input: z.infer<typeof applySourcePracticeBodySchema> & {
    readonly actor: string;
    readonly idempotencyKey: string;
  },
) => Promise<Result<PracticeImportReceipt, PracticeImportError>>;

export const validateSourcePracticeResultSchema = z
  .object({
    valid: z.literal(true),
    current: practiceImportReceiptSchema.nullable(),
  })
  .strict();
export type ValidateSourcePracticeOperation = (
  input: z.infer<typeof sourcePracticeSchema> & { readonly actor: string },
) => Promise<
  Result<
    z.infer<typeof validateSourcePracticeResultSchema>,
    PracticeImportError
  >
>;
