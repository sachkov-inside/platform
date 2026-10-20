import { z } from "zod";

/** Fixed service receipt. The caller cannot supply text, bot identity or a Telegram chat ID. */
export const waitlistConfirmationSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.waitlist-confirmation.v1">;
  eventId: z.ZodUUID;
  intakeId: z.ZodUUID;
  accountRef: z.ZodString;
  telegramIdentityRef: z.ZodString;
  linkRevision: z.ZodNumber;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.waitlist-confirmation.v1"),
  eventId: z.uuid(), intakeId: z.uuid(),
  accountRef: z.string().min(1).max(256),
  telegramIdentityRef: z.string().min(1).max(256),
  linkRevision: z.number().int().positive(),
});
export type WaitlistConfirmation = z.infer<typeof waitlistConfirmationSchema>;
export const waitlistConfirmationResultSchema: z.ZodObject<{
  eventId: z.ZodUUID;
  status: z.ZodEnum<{accepted: "accepted"; suppressed: "suppressed"}>;
}, z.core.$strict> = z.strictObject({eventId: z.uuid(), status: z.enum(["accepted", "suppressed"])});
