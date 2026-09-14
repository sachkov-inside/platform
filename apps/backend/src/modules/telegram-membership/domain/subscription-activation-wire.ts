import { z } from "zod";
import { bindingSnapshotSchema, activationOutcomeSchema, ACTIVATION_CONTRACT_VERSION, enrollmentViewSchema, ownAccessGroundSchema } from "../../membership-entitlements/index.js";
import { ownAdmissionSchema } from "./community-entitlement.js";
export const activationFailureSchema = z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.enum([
  "invalid_input", "not_found", "policy_paused", "revision_conflict", "operation_conflict", "identity_conflict", "source_not_confirmed", "forbidden", "unavailable",
]) }) });
export const activationResponseSchema = z.union([z.strictObject({ ok: z.literal(true), value: activationOutcomeSchema }), activationFailureSchema]);
export const bindingLookupResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: z.discriminatedUnion("state", [
    z.strictObject({ contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), state: z.literal("linked"), binding: bindingSnapshotSchema }),
    z.strictObject({ contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), state: z.literal("unlinked") }),
  ]) }),
  z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.enum(["invalid_input", "identity_conflict", "unavailable"]) }) }),
]);
export const ownSubscriptionAccessResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: z.strictObject({ contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), enrollments: z.array(enrollmentViewSchema), grounds: z.array(ownAccessGroundSchema), admission: ownAdmissionSchema }) }),
  activationFailureSchema,
]);
