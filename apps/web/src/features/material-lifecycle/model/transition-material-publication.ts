export interface TransitionMaterialPublicationInput {
  readonly expectedContentVersion: number;
  readonly materialId: string;
  readonly publicationState: "published" | "unpublished";
  readonly submissionId: string;
}

export type TransitionMaterialPublicationResult = z.infer<
  typeof transitionMaterialPublicationResultSchema
>;
import { z } from "zod";

/** The JSON body of the publication transition; another field is ignored, as the former form did. */
export const transitionMaterialPublicationInputSchema = z.object({
  expectedContentVersion: z.number().int().positive(),
  materialId: z.uuid(),
  publicationState: z.enum(["published", "unpublished"]),
  submissionId: z.uuid(),
});

const issueSchema = z.object({ code: z.string(), path: z.string() }).strict();

export const transitionMaterialPublicationResultSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        contentVersion: z.number().int().positive(),
        kind: z.literal("saved"),
        nextSubmissionId: z.uuid(),
        publicationState: z.enum(["published", "unpublished"]),
      })
      .strict(),
    z
      .object({
        issues: z.array(issueSchema).readonly(),
        kind: z.literal("invalid_input"),
      })
      .strict(),
    z.object({ kind: z.literal("unauthorized") }).strict(),
    z.object({ kind: z.literal("forbidden") }).strict(),
    z.object({ kind: z.literal("not_found") }).strict(),
    z
      .object({
        currentContentVersion: z.number().int().positive().optional(),
        kind: z.literal("conflict"),
        reason: z.enum([
          "product_removal_confirmation_required",
          "idempotency_key_reused",
          "invalid_publication_transition",
          "stale_content_version",
        ]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("infrastructure_error"),
        reference: z.string(),
      })
      .strict(),
    z
      .object({ kind: z.literal("unexpected_error"), reference: z.string() })
      .strict(),
  ],
);
