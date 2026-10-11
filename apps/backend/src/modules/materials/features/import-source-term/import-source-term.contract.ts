import { termDefinitionSchema } from "@inside/material-blocks";
import { z } from "zod";
import { authoringSourceSchema } from "../../domain/authoring-source.js";
import { termVersionSchema } from "../../domain/term-definition.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export const sourceTermSchema = z
  .object({
    definition: termDefinitionSchema,
    publicationState: z.enum(["draft", "published", "unpublished"]),
    source: authoringSourceSchema.omit({ showInFeed: true }),
  })
  .strict();
export const applySourceTermBodySchema = sourceTermSchema
  .extend({ expectedTermVersion: termVersionSchema.nullable() })
  .strict();
export const saveTermBodySchema = sourceTermSchema
  .omit({ source: true })
  .extend({ expectedTermVersion: termVersionSchema.nullable() })
  .strict();
export const termImportReceiptSchema = z
  .object({
    termId: z.uuid(),
    termVersion: termVersionSchema,
    definitionDigest: z.hash("sha256"),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    sourceId: z.string().nullable(),
    sourceRevision: z.hash("sha256").nullable(),
  })
  .strict();
export const validateSourceTermResultSchema = z
  .object({
    valid: z.literal(true),
    current: termImportReceiptSchema.nullable(),
  })
  .strict();
export type TermImportReceipt = z.infer<typeof termImportReceiptSchema>;
export type TermMutationError =
  | {
      readonly code:
        | "invalid_request_shape"
        | "forbidden"
        | "source_mismatch"
        | "term_version_conflict"
        | "idempotency_conflict"
        | "invalid_term_material";
    }
  | SystemError;
export type ValidateSourceTermOperation = (
  input: z.infer<typeof sourceTermSchema> & { readonly actor: string },
) => Promise<
  Result<z.infer<typeof validateSourceTermResultSchema>, TermMutationError>
>;
export type ApplySourceTermOperation = (
  input: z.infer<typeof applySourceTermBodySchema> & {
    readonly actor: string;
    readonly idempotencyKey: string;
  },
) => Promise<Result<TermImportReceipt, TermMutationError>>;
export type SaveTermOperation = (
  input: z.infer<typeof saveTermBodySchema> & {
    readonly actor: string;
    readonly idempotencyKey: string;
  },
) => Promise<Result<TermImportReceipt, TermMutationError>>;
