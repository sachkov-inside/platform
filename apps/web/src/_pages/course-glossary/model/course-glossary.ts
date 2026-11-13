import { z } from "zod";

import { glossaryTermSchema } from "@/entities/material.model";

export const courseGlossarySchema = z
  .object({
    product: z.object({ slug: z.string(), name: z.string() }).strict(),
    terms: z.array(
      glossaryTermSchema
        .extend({
          lesson: z.object({ slug: z.string(), title: z.string() }).strict(),
        })
        .strict(),
    ),
  })
  .strict();

export type CourseGlossary = z.infer<typeof courseGlossarySchema>;
export type CourseGlossaryTerm = CourseGlossary["terms"][number];

export type CourseGlossaryResult =
  | ({ readonly kind: "ready" } & CourseGlossary)
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };
