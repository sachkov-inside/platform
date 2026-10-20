import { z } from "zod";

export const emailAttachmentFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum([
    "unauthorized",
    "invalid_input",
    "challenge_invalid",
    "email_conflict",
    "rate_limited",
    "unavailable",
  ]),
});
export const readIdentityEmailSchema = z.union([
  z.object({ ok: z.literal(true), email: z.email().nullable() }),
  emailAttachmentFailureSchema,
]);
export const startIdentityEmailSchema = z.union([
  z.object({ ok: z.literal(true), challengeRef: z.string().min(1).max(128) }),
  emailAttachmentFailureSchema,
]);
export const confirmIdentityEmailSchema = z.union([
  z.object({ ok: z.literal(true) }),
  emailAttachmentFailureSchema,
]);
export type EmailAttachmentFailure = z.infer<
  typeof emailAttachmentFailureSchema
>;
export type IdentityEmail = z.infer<typeof readIdentityEmailSchema>;
export type StartIdentityEmail = z.infer<typeof startIdentityEmailSchema>;
export type ConfirmIdentityEmail = z.infer<typeof confirmIdentityEmailSchema>;
