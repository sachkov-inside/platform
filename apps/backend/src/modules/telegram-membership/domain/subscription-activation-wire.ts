import {
  botEnrollmentSchema,
  botActivationOutcomeSchema,
  botOwnAccessGroundSchema,
} from "./bot-domain-names.js";
import { z } from "zod";
import {
  bindingSnapshotSchema,
  ACTIVATION_CONTRACT_VERSION,
  invitationRedemptionOutcomeSchema,
} from "../../account-rights/index.js";
import { ownAdmissionSchema } from "./community-entitlement.js";
export const activationFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum([
      "invalid_input",
      "not_found",
      "policy_paused",
      "revision_conflict",
      "operation_conflict",
      "identity_conflict",
      "source_not_confirmed",
      "forbidden",
      "unavailable",
    ]),
  }),
});
export const activationResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: botActivationOutcomeSchema }),
  activationFailureSchema,
]);
export const bindingLookupResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: z.discriminatedUnion("state", [
      z.strictObject({
        contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
        state: z.literal("linked"),
        binding: bindingSnapshotSchema,
      }),
      z.strictObject({
        contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
        state: z.literal("unlinked"),
      }),
    ]),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(["invalid_input", "identity_conflict", "unavailable"]),
    }),
  }),
]);
export const ownSubscriptionAccessResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({
      contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
      enrollments: z.array(botEnrollmentSchema),
      grounds: z.array(botOwnAccessGroundSchema),
      admission: ownAdmissionSchema,
    }),
  }),
  activationFailureSchema,
]);
export const invitationRedeemResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: invitationRedemptionOutcomeSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(["invalid_input", "identity_conflict", "unavailable"]),
    }),
  }),
]);
