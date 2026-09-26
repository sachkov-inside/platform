import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  tributeWebhookSchema,
  tributeEventIdentity,
  tributeFingerprint,
} from "../../domain/tribute-webhook.js";
import {
  tributeInboxViewSchema,
  tributeStateSchema,
} from "../../domain/tribute-source.js";
import type {
  MembershipEntitlementsPrismaClient,
  MembershipEntitlementsPrisma,
} from "../../infrastructure/prisma.js";
import { projectTributeSource } from "../../shared/tribute-source.js";
import {
  lockAccountEntitlementChanges,
  lockAccountAccess,
} from "../../../../infrastructure/prisma/index.js";

export function tributeInboxView(row: {
  id: string;
  state: string;
  reason: string;
  sourceId: string | null;
  revision: number;
  receivedAt: Date;
  updatedAt: Date;
}) {
  return tributeInboxViewSchema.parse({
    id: row.id,
    state: row.state,
    reason: row.reason,
    sourceId: row.sourceId,
    revision: row.revision,
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
/** Authentication happens on original bytes before this durable inbox operation. */
export async function receiveTribute(
  prisma: MembershipEntitlementsPrismaClient,
  raw: Buffer,
  input: unknown,
  now: Date,
) {
  const parsed = tributeWebhookSchema.safeParse(input);
  const identity = parsed.success
    ? tributeEventIdentity(parsed.data)
    : {
        eventKey: tributeFingerprint(input),
        fingerprint: tributeFingerprint(input),
      };
  return prisma.$transaction(async (tx) => {
    await lockAccountAccess(tx, `tribute:inbox:${identity.eventKey}`);
    const previous = await tx.tributeInbox.findUnique({
      where: { fingerprint: identity.fingerprint },
    });
    if (previous) return { duplicate: true, value: tributeInboxView(previous) };
    const conflict = await tx.tributeInbox.findFirst({
      where: { eventKey: identity.eventKey },
    });
    const saved = await tx.tributeInbox.create({
      data: {
        id: randomUUID(),
        eventKey: identity.eventKey,
        fingerprint: identity.fingerprint,
        rawDigest: createHash("sha256").update(raw).digest("hex"),
        payload: { document: z.json().parse(input) },
        state: conflict ? "pending_reconciliation" : "received",
        reason: conflict ? "event_conflict" : "received",
        receivedAt: now,
        updatedAt: now,
        revision: 1,
      },
    });
    if (conflict) return { duplicate: false, value: tributeInboxView(saved) };
    return {
      duplicate: false,
      value: await reconcileTributeEvent(tx, saved.id, now),
    };
  });
}
/** Ambiguous time/order never replaces a previously confirmed paid period. */
export async function reconcileTributeEvent(
  tx: MembershipEntitlementsPrisma,
  inboxId: string,
  now: Date,
) {
  const inbox = await tx.tributeInbox.findUniqueOrThrow({
    where: { id: inboxId },
  });
  if (inbox.state === "applied" || inbox.state === "rejected")
    return tributeInboxView(inbox);
  const parsed = tributeWebhookSchema.safeParse(
    z.strictObject({ document: z.json() }).parse(inbox.payload).document,
  );
  const finish = async (
    state: "applied" | "pending_reconciliation" | "rejected",
    reason: string,
    sourceId: string | null = null,
  ) =>
    tributeInboxView(
      await tx.tributeInbox.update({
        where: { id: inbox.id },
        data: {
          state,
          reason,
          sourceId,
          revision: { increment: 1 },
          updatedAt: now,
        },
      }),
    );
  if (!parsed.success)
    return finish("pending_reconciliation", "unsupported_schema");
  if (
    (await tx.tributeInbox.count({
      where: { eventKey: inbox.eventKey, state: { not: "rejected" } },
    })) > 1
  )
    return finish("pending_reconciliation", "event_conflict");
  const event = parsed.data;
  const policy = await tx.tributePolicy.findUnique({
    where: { subscriptionId: event.payload.subscription_id },
  });
  if (policy === null || !policy.enabled)
    return finish("pending_reconciliation", "unknown_or_paused_source");
  if (event.payload.type !== "regular")
    return finish("pending_reconciliation", "paid_type_not_confirmed");
  if (
    new Date(event.created_at) > now ||
    new Date(event.sent_at) < new Date(event.created_at)
  )
    return finish("pending_reconciliation", "invalid_event_time");
  const candidates = await tx.sourceEntitlement.findMany({
    where: {
      origin: "tribute",
      sourcePolicyRef: policy.id,
      AND: [
        {
          tributeState: {
            path: ["subscriptionId"],
            equals: event.payload.subscription_id,
          },
        },
        {
          tributeState: {
            path: ["telegramUserId"],
            equals: String(event.payload.telegram_user_id),
          },
        },
      ],
    },
    take: 2,
  });
  if (candidates.length !== 1)
    return finish(
      "pending_reconciliation",
      "verified_identity_or_initial_period_required",
    );
  const candidate = candidates[0];
  if (!candidate)
    return finish("pending_reconciliation", "verified_identity_required");
  await lockAccountAccess(tx, `enrollment:tribute:${candidate.sourceRef}`);
  if (candidate.accountId !== null)
    await lockAccountEntitlementChanges(tx, candidate.accountId);
  const source = await tx.sourceEntitlement.findUniqueOrThrow({
    where: { id: candidate.id },
  });
  const state = tributeStateSchema.parse(source.tributeState);
  const enrollment =
    source.enrollmentId === null
      ? null
      : await tx.subscriptionEnrollment.findUnique({
          where: { id: source.enrollmentId },
        });
  if (source.revokedAt !== null || enrollment?.revokedAt != null)
    return finish("pending_reconciliation", "source_revoked", source.id);
  if (state.mode !== "confirmed_period")
    return finish(
      "pending_reconciliation",
      "initial_paid_period_required",
      source.id,
    );
  if (
    state.lastEventAt !== null &&
    Date.parse(event.created_at) <= Date.parse(state.lastEventAt)
  )
    return finish(
      "pending_reconciliation",
      "event_order_unconfirmed",
      source.id,
    );
  const end = Date.parse(event.payload.expires_at);
  const previousEnd = Date.parse(state.endsAt);
  if (end < previousEnd || end <= Date.parse(state.startsAt))
    return finish("pending_reconciliation", "period_conflict", source.id);
  if (event.name === "cancelled_subscription" && end !== previousEnd)
    return finish(
      "pending_reconciliation",
      "cancel_period_conflict",
      source.id,
    );
  if (event.name === "new_subscription" && end !== previousEnd)
    return finish(
      "pending_reconciliation",
      "new_period_requires_confirmation",
      source.id,
    );
  const next = tributeStateSchema.parse({
    ...state,
    endsAt:
      event.name === "renewed_subscription"
        ? event.payload.expires_at
        : state.endsAt,
    renewal: event.name === "cancelled_subscription" ? "stopped" : "enabled",
    lastEventAt: event.created_at,
    lastEventFingerprint: inbox.fingerprint,
  });
  const saved = await tx.sourceEntitlement.update({
    where: { id: source.id },
    data: {
      tributeState: next,
      checkedAt: now,
      revision: { increment: 1 },
      evidence: { inboxId: inbox.id, method: "signed_tribute_webhook" },
    },
  });
  // Pending sources retain their paid fact; the binding sweep materializes them after verified linking.
  if (source.accountId !== null && source.enrollmentId !== null) {
    const projected = await projectTributeSource(
      tx,
      saved,
      next,
      source.accountId,
      null,
      "Подтверждённое событие Tribute",
      now,
    );
    if (!projected.ok) throw new Error("Tribute source ownership changed");
  }
  return finish(
    "applied",
    event.name === "cancelled_subscription"
      ? "renewal_stopped_paid_remainder_retained"
      : "confirmed_external_period",
    source.id,
  );
}
