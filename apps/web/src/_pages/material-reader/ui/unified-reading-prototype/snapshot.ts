import { z } from "zod";
import { renderedMaterialBodySchema } from "@/entities/material.model";
import fixture from "../reader-programme-prototype/fixture.json";
import taskFixture from "./task-snapshot.json";

export const snapshot = z
  .object({
    courseTitle: z.string(),
    chapters: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        steps: z.array(z.string()),
      }),
    ),
    steps: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["material", "task"]),
        title: z.string(),
        chapter: z.number(),
        access: z.enum(["available", "locked", "unavailable"]),
      }),
    ),
    bodies: z.record(
      z.string(),
      z
        .unknown()
        .transform(
          (blocks) =>
            renderedMaterialBodySchema.parse({ schemaVersion: 1, blocks })
              .blocks,
        ),
    ),
    assetUrls: z.record(z.string(), z.string()),
  })
  .parse(fixture);
const taskPage = z
  .object({
    access: z.literal("open"),
    task: z.object({
      code: z.string(),
      version: z.number(),
      definition: z.object({
        criteria: z.array(
          z.object({
            id: z.string(),
            task: z.string(),
            explanation: z.string(),
          }),
        ),
      }),
    }),
    reviewProtocol: z.object({
      version: z.string(),
      instructions: z.array(z.string()),
    }),
    submission: z.object({ accepting: z.boolean() }),
  })
  .parse(taskFixture);
export const task = taskPage.task;
export const protocol = taskPage.reviewProtocol;
export const accepting = taskPage.submission.accepting;
export type Step = (typeof snapshot.steps)[number];
export const guideId = "inside-content-aie-ch1-project-setup";
export const taskId = "aie-ch1-harness";
export const variants = ["A", "B", "C"] as const;
export type Variant = (typeof variants)[number];
export const variantNames = {
  A: "Программа слева",
  B: "Оглавление справа",
  C: "Одна колонка",
};
export function findStep(id: string): Step {
  const step = snapshot.steps.find((item) => item.id === id);
  if (step === undefined) throw new Error("Missing fixture step: " + id);
  return step;
}
