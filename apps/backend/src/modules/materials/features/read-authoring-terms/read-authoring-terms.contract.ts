import { termDefinitionSchema } from "@inside/material-blocks";
import { z } from "zod";
import {
  termImportReceiptSchema,
  type TermMutationError,
} from "../import-source-term/import-source-term.contract.js";
import type { Result } from "../../result.js";

export const authoringTermSchema = termImportReceiptSchema
  .extend({ definition: termDefinitionSchema })
  .strict();
export const authoringTermsSchema = z
  .object({
    terms: z.array(authoringTermSchema).max(100),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export type ListAuthoringTermsOperation = (input: {
  readonly actor: string;
  readonly cursor?: string | undefined;
}) => Promise<Result<z.infer<typeof authoringTermsSchema>, TermMutationError>>;
export type LoadAuthoringTermOperation = (input: {
  readonly actor: string;
  readonly termId: string;
}) => Promise<
  Result<
    z.infer<typeof authoringTermSchema>,
    TermMutationError | { readonly code: "term_not_found" }
  >
>;
