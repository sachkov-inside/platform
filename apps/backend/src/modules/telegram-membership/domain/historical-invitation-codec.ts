import { z } from "zod";

/** Passive v1 receipt codecs only. No invitation command, route, port or issuance capability. */
const version = z.literal("inside.subscription-activation.v1");
export const historicalInvitationRequestSchema = z.strictObject({
  contractVersion: version,
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/u),
  identityRef: z.string().min(1).max(256),
});
const purchase = {
  contractVersion: version,
  mode: z.literal("purchase"),
  offerName: z.string().trim().min(1).max(200),
  checkoutUrl: z.url(),
};
export const historicalInvitationOutcomeSchema = z.union([
  z.strictObject({
    contractVersion: version,
    state: z.enum([
      "needs_account",
      "claimed_by_other",
      "expired",
      "revoked",
      "unavailable",
    ]),
  }),
  z.strictObject({ ...purchase, state: z.literal("purchase_ready") }),
  z.strictObject({ ...purchase, state: z.literal("already_redeemed") }),
]);
