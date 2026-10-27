import { decodeStoredSequenceDraft } from "./historical-sequence-decoder.js";
import { isDeepStrictEqual } from "node:util";
import { sql, type Selectable, type Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { lockContactRows, planDelivery } from "./communication-state.js";
import type {
  DeliveryPart,
  CommunicationSequenceDraft,
} from "./sequence-types.js";

type Delivery = Selectable<DatabaseSchema["communication_deliveries"]>;
export function relativeDue(
  joined: Date,
  firstPublished: Date,
  previous: Date,
  delay: number,
): Date {
  return new Date(Math.max(+joined, +firstPublished, +previous) + delay * 1000);
}
export function terminal(parts: readonly DeliveryPart[]): boolean {
  return parts.every((p) =>
    ["sent", "cancelled", "skipped", "suppressed"].includes(p.state),
  );
}
export function started(delivery: Delivery): boolean {
  return delivery.parts.some(
    (p) => p.attempts.length > 0 || p.state === "in_flight",
  );
}
export async function cancelDelivery(
  tx: Transaction<DatabaseSchema>,
  delivery: Delivery,
  now: Date,
  reason: string,
): Promise<Delivery> {
  if (delivery.completed_at) return delivery;
  const parts = delivery.parts;
  for (const part of parts) {
    if (part.state === "pending" || part.state === "failed") {
      part.state =
        delivery.kind === "broadcast" && reason === "marketing_unavailable"
          ? "suppressed"
          : "cancelled";
      part.diagnosticCode = reason;
    }
  }
  return tx
    .updateTable("communication_deliveries")
    .set({
      cancel_requested: true,
      cancellation_reason: reason,
      parts: JSON.stringify(parts),
      revision: delivery.revision + 1,
      completed_at: terminal(parts) ? now : null,
    })
    .where("delivery_id", "=", delivery.delivery_id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

// An event replans one BotContact; a publication replans one sequence's audience.
export type PlanScope =
  { readonly contactId: string } | { readonly sequenceId: string };
const PLAN_BATCH = 500;
type SequenceParticipation = Selectable<
  DatabaseSchema["communication_participations"]
> & {
  published: CommunicationSequenceDraft | null;
  published_revision: number | null;
};
type StepDefinition = Pick<
  Selectable<DatabaseSchema["communication_step_ids"]>,
  "sequence_id" | "step_id" | "first_published_at"
>;

// A contact scope runs under that contact's lock. A sequence scope runs under the bot scheduler
// lock and locks each batch's contact rows. Only a resume suppresses missed steps: it computes
// the virtual timeline once, using the current order; ordinary replanning never consumes them.
export async function reconcileSequences(
  tx: Transaction<DatabaseSchema>,
  bot: string,
  now: Date,
  scope: PlanScope,
  { suppressMissed = false }: { suppressMissed?: boolean } = {},
): Promise<void> {
  let query = tx
    .selectFrom("communication_participations as e")
    .innerJoin("communication_sequences as f", "f.sequence_id", "e.sequence_id")
    .selectAll("e")
    .select(["f.published", "f.published_revision"])
    .where("f.bot_identity", "=", bot)
    .where("f.published", "is not", null);
  query =
    "contactId" in scope
      ? query.where("e.contact_id", "=", scope.contactId)
      : query.where("e.sequence_id", "=", scope.sequenceId);
  const participations = await query.orderBy("e.participation_id").execute();
  for (let i = 0; i < participations.length; i += PLAN_BATCH) {
    const batch = participations.slice(i, i + PLAN_BATCH);
    const contactIds = [...new Set(batch.map((e) => e.contact_id))];
    const sequenceIds = [...new Set(batch.map((e) => e.sequence_id))];
    if ("sequenceId" in scope) await lockContactRows(tx, contactIds);
    const histories = new Map<string, Delivery[]>();
    for (const delivery of await tx
      .selectFrom("communication_deliveries")
      .selectAll()
      .where(sql<boolean>`contact_id = any(${contactIds}::uuid[])`)
      .where(sql<boolean>`sequence_id = any(${sequenceIds}::uuid[])`)
      .execute()) {
      const key = `${delivery.contact_id}:${delivery.sequence_id}`;
      histories.set(key, [...(histories.get(key) ?? []), delivery]);
    }
    const definitions = await tx
      .selectFrom("communication_step_ids")
      .select(["sequence_id", "step_id", "first_published_at"])
      .where(sql<boolean>`sequence_id = any(${sequenceIds}::uuid[])`)
      .execute();
    for (const participation of batch)
      await replanParticipation(
        tx,
        bot,
        now,
        participation,
        histories.get(
          `${participation.contact_id}:${participation.sequence_id}`,
        ) ?? [],
        definitions,
        suppressMissed,
      );
  }
}

async function replanParticipation(
  tx: Transaction<DatabaseSchema>,
  bot: string,
  now: Date,
  participation: SequenceParticipation,
  stored: readonly Delivery[],
  definitions: readonly StepDefinition[],
  suppressMissed: boolean,
): Promise<void> {
  const draft =
    participation.published === null
      ? null
      : decodeStoredSequenceDraft(participation.published);
  const revision = participation.published_revision;
  if (!draft || revision === null)
    throw new Error("Only a published sequence is replanned");
  const history: Delivery[] = [];
  for (const delivery of stored)
    history.push(
      delivery.kind === "step" &&
        !draft.steps.some((s) => s.stepId === delivery.step_id)
        ? await cancelDelivery(tx, delivery, now, "step_deleted")
        : delivery,
    );
  const initial = history.find(
    (d) => d.dedup_key === participation.initial_entry_key,
  );
  if (!initial?.completed_at) return;
  // Started work owns the lane even after reorder/delete. Pending work can change order.
  if (history.some((d) => d.kind === "step" && !d.completed_at && started(d)))
    return;
  let previous = new Date(
    Math.max(
      +initial.completed_at,
      ...history.flatMap((d) =>
        d.kind === "step" && d.completed_at ? [+d.completed_at] : [],
      ),
    ),
  );
  for (const step of draft.steps) {
    const old = history.find(
      (d) => d.kind === "step" && d.step_id === step.stepId,
    );
    if (old?.completed_at) continue;
    const definition = definitions.find(
      (d) => d.sequence_id === draft.sequenceId && d.step_id === step.stepId,
    );
    if (!definition) throw new Error("Published step has no identity record");
    const due =
      step.delayAnchor === "entry"
        ? new Date(+participation.participated_at + step.delaySeconds * 1000)
        : relativeDue(
            participation.participated_at,
            definition.first_published_at,
            previous,
            step.delaySeconds,
          );
    const suppressed = suppressMissed && +due <= +now;
    const parts: DeliveryPart[] = step.parts.map((p) => ({
      partId: p.partId,
      state: suppressed ? "suppressed" : "pending",
      diagnosticCode: suppressed ? "marketing_unavailable" : null,
      attempts: [],
    }));
    if (!old) {
      await planDelivery(tx, {
        bot,
        contactId: participation.contact_id,
        sequenceId: draft.sequenceId,
        stepId: step.stepId,
        kind: "step",
        key: `step:${participation.participation_id}:${step.stepId}`,
        parts: step.parts,
        revision,
        now,
        dueAt: due,
      });
    }
    if (
      !old ||
      +old.due_at !== +due ||
      old.published_revision !== revision ||
      !isDeepStrictEqual(old.snapshot, step.parts) ||
      suppressed
    ) {
      await tx
        .updateTable("communication_deliveries")
        .set({
          snapshot: JSON.stringify(step.parts),
          parts: JSON.stringify(parts),
          published_revision: revision,
          due_at: due,
          revision: (old?.revision ?? 1) + 1,
          completed_at: suppressed ? due : null,
        })
        .where(
          "dedup_key",
          "=",
          `step:${participation.participation_id}:${step.stepId}`,
        )
        .execute();
    }
    if (!suppressed) break;
    previous = due;
  }
}

export function deliveryView(r: Delivery) {
  return {
    deliveryId: r.delivery_id,
    revision: r.revision,
    contactId: r.contact_id,
    sequenceId: r.sequence_id,
    broadcastId: r.broadcast_id,
    stepId: r.step_id,
    publishedRevision: r.published_revision,
    snapshot: r.snapshot,
    parts: r.parts,
    cancelRequested: r.cancel_requested,
    completedAt: r.completed_at?.toISOString() ?? null,
  };
}
