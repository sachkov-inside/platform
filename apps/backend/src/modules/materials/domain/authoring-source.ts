import { z } from "zod";

export const authoringSourceIdSchema = z.string().trim().min(1).max(200);

/** The part of a source ID before its first `:`, naming the content repository that owns it. */
export const authoringSourceNamespaceSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

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
