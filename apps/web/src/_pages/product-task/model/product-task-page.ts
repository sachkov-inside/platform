import { z } from "zod";
import { renderedMaterialBodySchema } from "@/entities/material.model";

const criterionSchema = z
  .object({
    id: z.string(),
    level: z.enum(["required", "additional"]),
    requirement: z.string(),
    acceptableEvidence: z.array(z.string()),
  })
  .strict();

const criterionV2Schema = z
  .object({
    id: z.string(),
    level: z.enum(["required", "additional"]),
    task: z.string(),
    explanation: z.string(),
    advice: z.string().optional(),
  })
  .strict();

const historicalCriterionV2Schema = criterionV2Schema.extend({
  acceptableEvidence: z.array(z.string()),
});

const definitionV1Schema = z
  .object({
    situation: z.string(),
    result: z.array(z.string()),
    freedom: z.string(),
    criteria: z.array(criterionSchema),
  })
  .strict();

const definitionV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    format: z.literal("c"),
    intro: z.string(),
    freedom: z.string(),
    criteria: z.array(criterionV2Schema),
  })
  .strict();

const placeShape = {
  code: z.string(),
  title: z.string(),
  product: z.object({ slug: z.string(), name: z.string() }).strict(),
  chapter: z.object({ name: z.string(), ordinal: z.number().int() }).strict(),
};

export const productTaskPageSchema = z.discriminatedUnion("access", [
  z
    .object({
      access: z.literal("open"),
      task: z
        .object({
          ...placeShape,
          access: z.enum(["free", "closed"]),
          version: z.number().int().positive(),
          definition: z.union([definitionV1Schema, definitionV2Schema]),
          page: z
            .object({
              title: z.string(),
              summary: z.string(),
              body: renderedMaterialBodySchema,
              cover: z
                .object({ assetId: z.string(), alt: z.string() })
                .strict()
                .nullable(),
              artifacts: z.array(
                z
                  .object({
                    sourceId: z.string(),
                    title: z.string(),
                    assetId: z.string(),
                  })
                  .strict(),
              ),
            })
            .strict()
            .optional(),
        })
        .strict(),
      reviewProtocol: z
        .object({ version: z.string(), instructions: z.array(z.string()) })
        .strict(),
      relatedMaterials: z.array(
        z
          .object({
            slug: z.string(),
            title: z.string(),
            availability: z.enum(["available", "locked", "unavailable"]),
          })
          .strict(),
      ),
      submission: z.object({ accepting: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      access: z.literal("closed"),
      task: z.object(placeShape).strict(),
    })
    .strict(),
]);

export const ownTaskSubmissionsSchema = z
  .object({
    code: z.string(),
    currentVersion: z.number().int().positive(),
    versions: z.array(
      z
        .object({
          version: z.number().int().positive(),
          criteria: z.array(
            z.union([criterionSchema, historicalCriterionV2Schema]),
          ),
        })
        .strict(),
    ),
    submissions: z.array(
      z
        .object({
          submissionId: z.string(),
          taskVersion: z.number().int().positive(),
          source: z.enum(["mcp", "form"]),
          submittedAt: z.iso.datetime(),
          note: z.string(),
          reportText: z.string().nullable(),
          repositoryUrl: z.string().nullable(),
          authorFeedback: z
            .object({
              comment: z.string().nullable(),
              reviewedAt: z.iso.datetime().nullable(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type TaskCriterion =
  | z.infer<typeof criterionSchema>
  | z.infer<typeof criterionV2Schema>
  | z.infer<typeof historicalCriterionV2Schema>;
export type OpenProductTask = Extract<
  z.infer<typeof productTaskPageSchema>,
  { access: "open" }
>;
/** Where a task stands: its code, title, Product and chapter; a closed task shows only this. */
export type ProductTaskPlace = Extract<
  z.infer<typeof productTaskPageSchema>,
  { access: "closed" }
>["task"];
export type OwnTaskSubmissions = z.infer<typeof ownTaskSubmissionsSchema>;

/** What the task route renders: the page, a closed task by its place, 404 or a dependency pause. */
export type ProductTaskPageResult =
  | { readonly kind: "open"; readonly page: OpenProductTask }
  | { readonly kind: "closed"; readonly task: ProductTaskPlace }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

/** «Мои сдачи»: a guest has none to show, a dependency pause does not hide the task itself. */
export type OwnSubmissionsView =
  | { readonly kind: "guest" }
  | { readonly kind: "unavailable" }
  | ({ readonly kind: "ready" } & OwnTaskSubmissions);
