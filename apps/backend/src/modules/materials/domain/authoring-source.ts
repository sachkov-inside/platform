import { z } from "zod";

export const authoringSourceIdSchema = z.string().trim().min(1).max(200);

/**
 * The Git commit of the content repository the source was read from. PostgreSQL stores it in
 * lowercase, so a request spelled in uppercase is normalized rather than refused.
 */
export const authoringSourceCommitSchema = z.hash("sha1").toLowerCase();

export const authoringSourceSchema = z
  .object({
    id: authoringSourceIdSchema,
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
    revision: z.hash("sha256"),
    showInFeed: z.boolean(),
    /**
     * Absent or `null` when the content does not come from a known commit. `null` lets a client
     * send back the source it read without dropping the field.
     */
    commit: authoringSourceCommitSchema.nullable().optional(),
  })
  .strict();

export type AuthoringSource = z.infer<typeof authoringSourceSchema>;

/**
 * The source a Material currently records. A source write without a commit records `null`:
 * the content then no longer comes from a known commit.
 */
export const recordedAuthoringSourceSchema = authoringSourceSchema
  .extend({ commit: authoringSourceCommitSchema.nullable() })
  .strict();

export type RecordedAuthoringSource = z.infer<
  typeof recordedAuthoringSourceSchema
>;

/**
 * The source `GET /authoring/materials/{id}` reports. `commit` appears only when one is recorded:
 * authoring clients that predate the commit read this object with a strict schema that refuses an
 * unknown key, and only a newer client records a commit.
 */
export const reportedAuthoringSourceSchema = authoringSourceSchema
  .extend({ commit: authoringSourceCommitSchema.optional() })
  .strict();

export type ReportedAuthoringSource = z.infer<
  typeof reportedAuthoringSourceSchema
>;
