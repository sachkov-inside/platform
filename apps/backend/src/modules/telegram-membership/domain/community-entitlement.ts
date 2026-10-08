import {
  communityGroupUrlSchema,
  communityAccessSchema,
  communityBindingSchema,
  type CommunityAccess,
} from "@inside/contracts/community-result";
export {
  communityAccessSchema,
  communityBindingSchema,
  communityStatusSchema,
  observedMembershipSchema,
  communityResultSchema,
} from "@inside/contracts/community-result";
export type {
  CommunityAccess,
  CommunityBinding,
  CommunityDeliveryStatus,
  ObservedMembership,
  CommunityResult,
} from "@inside/contracts/community-result";
import { z } from "zod";

export const COMMUNITY_CONTRACT_VERSION = "inside.community-entitlement.v1";
export const COMMUNITY_V2_CONTRACT_VERSION = "inside.community-entitlement.v2";
export const admissionRestrictionSchema = z.enum([
  "none",
  "moderation",
  "external_unknown",
]);
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
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().positive();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const communitySetSchema = z.strictObject({
  contractVersion: z.enum([
    COMMUNITY_CONTRACT_VERSION,
    COMMUNITY_V2_CONTRACT_VERSION,
  ]),
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
  contractVersion: z.enum([
    COMMUNITY_CONTRACT_VERSION,
    COMMUNITY_V2_CONTRACT_VERSION,
  ]),
  operation: z.literal("entitlement.status"),
  operationId: id,
});

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
  contractVersion: z.enum([
    COMMUNITY_CONTRACT_VERSION,
    COMMUNITY_V2_CONTRACT_VERSION,
  ]),
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
    COMMUNITY_V2_CONTRACT_VERSION,
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

/** New writes have one negotiated target; historical readers retain v1. */
export const communityV2SetSchema = communitySetSchema.extend({
  contractVersion: z.literal(COMMUNITY_V2_CONTRACT_VERSION),
});

export const ownAdmissionSchema = z.strictObject({
  admissionRestriction: admissionRestrictionSchema.nullable(),
  state: z.enum(["checking", "no_access", "moderation_blocked", "ready"]),
});
export type OwnAdmission = z.infer<typeof ownAdmissionSchema>;

/**
 * Какой переход в сообщество показать самому Account рядом с покупкой. Вступление идёт через
 * бота: только он выдаёт личную ссылку в группу по `/community`, поэтому `join` несёт адрес бота
 * без параметра `/start`. Для участника provider может передать адрес группы; без адреса остаётся статус.
 */
export const ownCommunityEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("link_telegram") }),
  z.strictObject({ kind: z.literal("preparing") }),
  z.strictObject({ kind: z.literal("join"), botUrl: z.url() }),
  z.strictObject({
    kind: z.literal("member"),
    groupUrl: communityGroupUrlSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("restricted") }),
]);
export type OwnCommunityEntry = z.infer<typeof ownCommunityEntrySchema>;
