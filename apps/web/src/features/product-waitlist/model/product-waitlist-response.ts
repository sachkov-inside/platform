import { z } from "zod";
const membership = z.object({
  intakeId: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});
export const waitlistReadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("guest") }),
  membership.extend({
    kind: z.literal("ready"),
    continuation: z.boolean(),
    accountId: z.uuid(),
  }),
  z.object({ kind: z.literal("unavailable") }),
]);
export const waitlistMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sign-in"), returnTo: z.string() }),
  z.object({ kind: z.literal("continue") }),
  z.object({ kind: z.literal("telegram-required") }),
  z.object({ kind: z.literal("expired") }),
  z.object({ kind: z.literal("unavailable") }),
  membership.extend({ kind: z.literal("saved") }),
]);
