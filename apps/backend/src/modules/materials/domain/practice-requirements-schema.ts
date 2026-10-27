import { z } from "zod";

const text = z.string().trim().min(1).max(16_000);
const criterionId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(100);

/** Authored data, never agent instructions or an executable verification script. */
export const practiceDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(200),
    businessInputs: text,
    expectedOutcome: text,
    allowedFreedom: text,
    criteria: z
      .array(
        z
          .object({
            id: criterionId,
            requirement: text,
            acceptableEvidence: z.array(text).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.criteria.map((item) => item.id)).size !==
      value.criteria.length
    )
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Duplicate criterion ID",
      });
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 128 * 1024)
      context.addIssue({
        code: "custom",
        message: "Practice definition exceeds 128 KiB",
      });
  });
