import { z } from "zod";

const memberProfileProblemSchema = z
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

export type MemberProfileProblem = Readonly<
  z.infer<typeof memberProfileProblemSchema>
>;

export function parseMemberProfileProblem(
  value: unknown,
): MemberProfileProblem | null {
  const parsed = memberProfileProblemSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
