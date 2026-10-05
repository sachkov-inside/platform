import { z } from "zod";

const criterionSchema = z
  .object({
    id: z.string(),
    level: z.enum(["required", "additional"]),
    requirement: z.string(),
    acceptableEvidence: z.array(z.string()),
  })
  .strict();

const placeShape = {
  code: z.string(),
  title: z.string(),
  guide: z.object({ slug: z.string(), name: z.string() }).strict(),
  chapter: z.object({ name: z.string(), ordinal: z.number().int() }).strict(),
};

export const guideTaskPageSchema = z.discriminatedUnion("access", [
  z
    .object({
      access: z.literal("open"),
      task: z
        .object({
          ...placeShape,
          access: z.enum(["free", "membership"]),
          version: z.number().int().positive(),
          definition: z
            .object({
              situation: z.string(),
              result: z.array(z.string()),
              freedom: z.string(),
              criteria: z.array(criterionSchema),
            })
            .strict(),
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
          criteria: z.array(criterionSchema),
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

export type TaskCriterion = z.infer<typeof criterionSchema>;
export type OpenGuideTask = Extract<
  z.infer<typeof guideTaskPageSchema>,
  { access: "open" }
>;
/** Where a task stands: its code, title, Guide and chapter; a closed task shows only this. */
export type GuideTaskPlace = Extract<
  z.infer<typeof guideTaskPageSchema>,
  { access: "closed" }
>["task"];
export type OwnTaskSubmissions = z.infer<typeof ownTaskSubmissionsSchema>;

/** What the task route renders: the page, a closed task by its place, 404 or a dependency pause. */
export type GuideTaskPageResult =
  | { readonly kind: "open"; readonly page: OpenGuideTask }
  | { readonly kind: "closed"; readonly task: GuideTaskPlace }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

/** «Мои сдачи»: a guest has none to show, a dependency pause does not hide the task itself. */
export type OwnSubmissionsView =
  | { readonly kind: "guest" }
  | { readonly kind: "unavailable" }
  | ({ readonly kind: "ready" } & OwnTaskSubmissions);
