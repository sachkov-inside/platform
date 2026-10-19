import { z } from "zod";
export const waitlistIntakeSchema = z.strictObject({
  intakeId: z.uuid(),
  name: z.string(),
});
export const waitlistMembershipSchema = waitlistIntakeSchema.extend({
  active: z.boolean(),
});
export const joinWaitlistSchema = z.strictObject({
  intakeId: z.uuid(),
  operationId: z.uuid(),
  source: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .nullable(),
});
export const withdrawWaitlistSchema = z.strictObject({ intakeId: z.uuid() });
