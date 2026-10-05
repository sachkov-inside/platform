import { z } from "zod";
import { contractDigest } from "../../../infrastructure/contracts/canonical-digest.js";

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(120);

/** The Content ID without its namespace, for example `aie-ch1-onboarding`; it never changes. */
export const taskCodeSchema = identifier;

/** `inside-content:<code>`: the source of a Guide Task names its code. */
export const taskSourceIdSchema = z
  .string()
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const text = z.string().trim().min(1).max(16_000);
const criterionIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(100);

export const criterionLevelSchema = z.enum(["required", "additional"]);

/**
 * The requirements of one Task Version (`schemaVersion: 1`). Authored data for the learner and
 * their agent, never agent instructions or an executable check. Title, access, related Materials
 * and publication stay outside, so changing them creates no new version.
 */
export const taskDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    situation: text,
    result: z.array(z.string().trim().min(1).max(2_000)).min(1).max(20),
    freedom: text,
    criteria: z
      .array(
        z
          .object({
            id: criterionIdSchema,
            level: criterionLevelSchema,
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
    if (!value.criteria.some((item) => item.level === "required"))
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "A task needs at least one required criterion",
      });
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 128 * 1024)
      context.addIssue({
        code: "custom",
        message: "Task definition exceeds 128 KiB",
      });
  });

export const taskProvenanceSchema = z
  .object({
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
      .max(256),
    commit: z.hash("sha1"),
    path: z
      .string()
      .min(1)
      .max(1000)
      .refine(
        (value) =>
          !value.startsWith("/") &&
          !/^[A-Za-z]:/u.test(value) &&
          !value.includes("\\") &&
          !value.split("/").includes("..") &&
          !Array.from(value).some((character) => character.charCodeAt(0) < 32),
        "Expected a relative source path",
      ),
  })
  .strict();

export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type TaskProvenance = z.infer<typeof taskProvenanceSchema>;

/** Only the definition decides whether an import creates a new Task Version. */
export function taskDefinitionDigest(definition: TaskDefinition): string {
  return contractDigest(definition);
}
