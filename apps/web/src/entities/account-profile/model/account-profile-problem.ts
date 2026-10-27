import { z } from "zod";

const accountProfileProblemSchema = z
  .object({
    code: z.string(),
    correlationId: z.string().optional(),
    currentVersion: z.number().int().positive().optional(),
    issues: z
      .array(
        z
          .object({
            code: z.enum([
              "required",
              "too_short",
              "too_long",
              "invalid_characters",
            ]),
            field: z.enum(["bio", "displayName"]),
          })
          .strict(),
      )
      .optional(),
    status: z.number().int(),
  })
  .loose();

export type AccountProfileProblem = Readonly<
  z.infer<typeof accountProfileProblemSchema>
>;

export function parseAccountProfileProblem(
  value: unknown,
): AccountProfileProblem | null {
  const parsed = accountProfileProblemSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
