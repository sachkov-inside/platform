import { z } from "zod";

export const COMMUNITY_CONTRACT_VERSION = "inside.community-entitlement.v1";
export const DISPATCH_CONTRACT_VERSION = "inside.billing-dispatch.v1";
/** A dispatch permit is a freshness check, never a reservation of the external effect. */
export const PERMIT_LIFETIME_MS = 5_000;
/** Our own sweep over known desired states; not a promise about Telegram availability. */
export const COMMUNITY_RECONCILIATION_INTERVAL_MS = 60_000;
/** Delivery unfinished for longer than this is operator-visible work, not a silent retry. */
export const COMMUNITY_OVERDUE_MS = 5 * 60_000;
export const COMMUNITY_REQUEST_TIMEOUT_MS = 5_000;
export const COMMUNITY_MAXIMUM_BODY_BYTES = 16 * 1024;
/** Backoff for a delivery that never reached a durable acceptance. */
export const COMMUNITY_RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;
/** The community capability a paid, manual or legacy grant can carry. */
export const COMMUNITY_CAPABILITY = "community";

const id = z.uuid();
const opaqueRef = z.string().min(1).max(256);
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().positive();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const communityAccessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("denied") }),
  z.strictObject({ kind: z.literal("finite"), validUntil: instant }),
  z.strictObject({ kind: z.literal("lifetime") }),
]);
export type CommunityAccess = z.infer<typeof communityAccessSchema>;

export const communityBindingSchema = z.strictObject({
  accountRef: opaqueRef,
  telegramIdentityRef: opaqueRef,
  linkRef: id,
  linkRevision: revision,
});
export type CommunityBinding = z.infer<typeof communityBindingSchema>;

export const communitySetSchema = z.strictObject({
  contractVersion: z.literal(COMMUNITY_CONTRACT_VERSION),
  operation: z.literal("entitlement.set"),
  operationId: id,
  binding: communityBindingSchema,
  entitlementRevision: revision,
  access: communityAccessSchema,
  issuedAt: instant,
  correlationRef: id,
});
export type CommunitySetCommand = z.infer<typeof communitySetSchema>;

export const communityStatusQuerySchema = z.strictObject({
  contractVersion: z.literal(COMMUNITY_CONTRACT_VERSION),
  operation: z.literal("entitlement.status"),
  operationId: id,
});

export const communityStatusSchema = z.enum([
  "accepted",
  "waiting_for_join",
  "applied",
  "superseded",
  "failed",
  "unknown",
  "expired",
]);
export type CommunityDeliveryStatus = z.infer<typeof communityStatusSchema>;

export const observedMembershipSchema = z.enum([
  "member",
  "not_member",
  "unknown",
]);
export type ObservedMembership = z.infer<typeof observedMembershipSchema>;

export const communityResultSchema = z
  .strictObject({
    contractVersion: z.literal(COMMUNITY_CONTRACT_VERSION),
    operation: z.literal("entitlement.result"),
    operationId: id,
    binding: communityBindingSchema,
    entitlementRevision: revision,
    access: communityAccessSchema,
    status: communityStatusSchema,
    observedMembership: observedMembershipSchema,
    updatedAt: instant,
  })
  // `applied` claims an observation; `expired` only fits a finite right.
  .refine((value) =>
    value.status === "applied"
      ? value.access.kind === "denied"
        ? value.observedMembership === "not_member"
        : value.observedMembership === "member"
      : true,
  )
  .refine(
    (value) => value.status !== "expired" || value.access.kind === "finite",
  );
export type CommunityResult = z.infer<typeof communityResultSchema>;

export const communityErrorCodeSchema = z.enum([
  "unauthorized",
  "unsupported_contract",
  "malformed",
  "not_found",
  "operation_conflict",
  "revision_conflict",
  "binding_conflict",
  "unavailable",
]);
export type CommunityErrorCode = z.infer<typeof communityErrorCodeSchema>;

export const communityErrorSchema = z.strictObject({
  contractVersion: z.literal(COMMUNITY_CONTRACT_VERSION),
  operation: z.literal("entitlement.error"),
  operationId: id,
  error: communityErrorCodeSchema,
});

export const communityEffectSchema = z.enum([
  "community.ensure_admission",
  "community.approve_join",
  "community.ensure_absence",
]);
export type CommunityEffect = z.infer<typeof communityEffectSchema>;

export const dispatchAuthorizeSchema = z.strictObject({
  contractVersion: z.literal(DISPATCH_CONTRACT_VERSION),
  operation: z.literal("dispatch.authorize"),
  operationId: id,
  dispatchId: id,
  dispatchContractVersion: z.enum([
    COMMUNITY_CONTRACT_VERSION,
    "inside.billing-notification.v1",
  ]),
  attemptId: id,
  effectRef: id,
  effect: z.enum([
    "community.ensure_admission",
    "community.approve_join",
    "community.ensure_absence",
    "notice.send",
  ]),
  payloadDigest: digest,
});
export type DispatchAuthorizeRequest = z.infer<typeof dispatchAuthorizeSchema>;

export const dispatchDenialReasonSchema = z.enum([
  "superseded",
  "binding_conflict",
  "expired",
  "not_found",
  "payload_conflict",
  "effect_conflict",
]);
export type DispatchDenialReason = z.infer<typeof dispatchDenialReasonSchema>;

export const dispatchDecisionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("allowed"),
    permitRef: id,
    validUntil: instant,
  }),
  z.strictObject({
    status: z.literal("denied"),
    reason: dispatchDenialReasonSchema,
  }),
  z.strictObject({ status: z.literal("unavailable") }),
]);
export type DispatchDecision = z.infer<typeof dispatchDecisionSchema>;

export const dispatchResultSchema = z.strictObject({
  contractVersion: z.literal(DISPATCH_CONTRACT_VERSION),
  operation: z.literal("dispatch.result"),
  operationId: id,
  dispatchId: id,
  attemptId: id,
  decision: dispatchDecisionSchema,
});
export type DispatchResult = z.infer<typeof dispatchResultSchema>;

export const dispatchErrorSchema = z.strictObject({
  contractVersion: z.literal(DISPATCH_CONTRACT_VERSION),
  operation: z.literal("dispatch.error"),
  operationId: id,
  error: communityErrorCodeSchema,
});
export type DispatchError = z.infer<typeof dispatchErrorSchema>;

export function accessAllows(access: CommunityAccess, now: Date): boolean {
  if (access.kind === "denied") return false;
  if (access.kind === "lifetime") return true;
  return Date.parse(access.validUntil) > now.getTime();
}

export function sameAccess(
  left: CommunityAccess,
  right: CommunityAccess,
): boolean {
  if (left.kind === "finite") {
    return right.kind === "finite" && left.validUntil === right.validUntil;
  }
  return left.kind === right.kind;
}

/** The one rule turning a resolved capability set into a community delivery instruction. */
export function communityAccessFor(
  capabilities: readonly {
    readonly capability: string;
    readonly validUntil: string | null;
  }[],
): CommunityAccess {
  const community = capabilities.find(
    (value) => value.capability === COMMUNITY_CAPABILITY,
  );
  if (community === undefined) return { kind: "denied" };
  return community.validUntil === null
    ? { kind: "lifetime" }
    : { kind: "finite", validUntil: community.validUntil };
}
