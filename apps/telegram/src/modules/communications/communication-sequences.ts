import { decodeStoredSequenceDraft } from "./historical-sequence-decoder.js";
import {
  WAITLIST_AUTHORIZATION,
  DisabledWaitlistAuthorization,
  type WaitlistAuthorization,
} from "./waitlist-authorization.js";
import { isTruthy } from "../../shared/truthiness.js";
import { hasText } from "../../shared/text.js";
import {
  AUTHOR_CONTENT_VALIDATION,
  type AuthorContentValidation,
  validateAuthorContent,
} from "./author-content-validation.js";
import { previewSequence, type SequencePreview } from "./sequence-preview.js";
import { transactionWithExternalReads } from "../../database/external-reads.js";
import { deliveryOwnerPredicate, nextCursor } from "./communication-queries.js";
import { applyBroadcast, type BroadcastResult } from "./broadcasts.js";
import {
  readStatistics,
  readEntries,
  type StatisticsResult,
  type EntriesResult,
} from "./communication-statistics.js";
import {
  reconcileSequences,
  terminal,
  deliveryView,
} from "./sequence-timeline.js";
import {
  communicationLock,
  lockContactRows,
  lockDeliveryContact,
  replayedResult,
  schedulerLock,
} from "./communication-state.js";
import { isDeepStrictEqual } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import {
  DATABASE,
  type Database,
  type DatabaseSchema,
} from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import {
  AUTHOR_AUTHORIZATION,
  authorizeAuthor,
  type AuthorAuthorization,
} from "./author-authorization.js";
import {
  CommunicationsError,
  type CommunicationsRequest,
  requiredField,
  validateContent,
} from "./communications-contract.js";
import type {
  CommunicationSequenceDraft,
  CommunicationSequenceSnapshot,
  IntroSnapshot,
  MessagePart,
  DeliverySnapshot,
} from "./sequence-types.js";

export type SequenceResult =
  | {
      receipt: {
        operationId: string;
        requestJson: string;
        resultJson: string;
        createdAt: string;
      };
    }
  | { preview: SequencePreview }
  | BroadcastResult
  | StatisticsResult
  | EntriesResult
  | { sequence: CommunicationSequenceSnapshot }
  | { sequences: CommunicationSequenceSnapshot[]; nextCursor: string | null }
  | { intro: IntroSnapshot }
  | {
      deliveryId: string;
      partId: string;
      outcome: "skipped" | "retry_requested";
    }
  | { deliveries: DeliverySnapshot[]; nextCursor: string | null };

const LIFECYCLE_AFTER = {
  pause: "paused",
  resume: "published",
  archive: "archived",
  restore: "paused",
} as const;

@Injectable()
export class CommunicationSequences {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(AUTHOR_AUTHORIZATION)
    private readonly authorization: AuthorAuthorization,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTHOR_CONTENT_VALIDATION)
    private readonly contentValidation: AuthorContentValidation,
    @Inject(WAITLIST_AUTHORIZATION)
    private readonly waitlist: WaitlistAuthorization = new DisabledWaitlistAuthorization(),
  ) {}
  async execute(
    request: CommunicationsRequest,
    transaction?: Transaction<DatabaseSchema>,
  ): Promise<SequenceResult> {
    if (!("accountRef" in request.actor))
      throw new CommunicationsError("not_implemented");
    const actor = request.actor.accountRef;
    const permission = await authorizeAuthor(this.authorization, {
      kind: "account",
      accountRef: actor,
    });
    if (permission !== "allowed")
      throw new CommunicationsError(
        permission === "denied" ? "forbidden" : "authorization_unavailable",
      );
    const work = async (tx: Transaction<DatabaseSchema>) => {
      await communicationLock(
        tx,
        `communications-operation:${this.config.botIdentity}:${request.operationId}`,
      );
      const prior = await tx
        .selectFrom("communication_operations")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .where("operation_id", "=", request.operationId)
        .executeTakeFirst();
      if (prior) {
        if (
          prior.actor_account_ref !== actor ||
          !isDeepStrictEqual(prior.request, request)
        )
          throw new CommunicationsError("operation_conflict");
        return replayedResult<SequenceResult>(prior);
      }
      await communicationLock(
        tx,
        `communications-definitions:${this.config.botIdentity}`,
      );
      await schedulerLock(tx, this.config.botIdentity);
      const result = await this.apply(tx, request, actor);
      if (
        ![
          "receipts.read",
          "sequences.read",
          "sequences.list",
          "sequences.preview",
          "intro.read",
          "deliveries.read",
          "broadcasts.read",
          "broadcasts.preview",
          "broadcasts.list",
          "statistics.read",
          "entries.read",
        ].includes(request.operation)
      ) {
        await tx
          .insertInto("communication_operations")
          .values({
            bot_identity: this.config.botIdentity,
            operation_id: request.operationId,
            actor_account_ref: actor,
            request: JSON.stringify(request),
            result: JSON.stringify(result),
            created_at: this.clock.now(),
          })
          .execute();
      }
      return result;
    };
    return transaction
      ? work(transaction)
      : transactionWithExternalReads(this.database, work);
  }
  private async apply(
    tx: Transaction<DatabaseSchema>,
    request: CommunicationsRequest,
    actor: string,
  ): Promise<SequenceResult> {
    const { operation, payload, expectedRevision } = request;
    if (operation === "receipts.read") {
      const receipt = await tx
        .selectFrom("communication_operations")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .where("actor_account_ref", "=", actor)
        .where("operation_id", "=", requiredField(payload.receiptOperationId))
        .executeTakeFirst();
      if (!receipt) throw new CommunicationsError("not_found");
      return {
        receipt: {
          operationId: receipt.operation_id,
          requestJson: JSON.stringify(receipt.request),
          resultJson: JSON.stringify(receipt.result),
          createdAt: receipt.created_at.toISOString(),
        },
      };
    }

    const bot = this.config.botIdentity;
    if (operation.startsWith("broadcasts."))
      return applyBroadcast(
        tx,
        request,
        bot,
        actor,
        this.clock.now(),
        this.waitlist,
      );
    if (operation === "statistics.read")
      return readStatistics(tx, request, bot, actor);
    if (operation === "entries.read")
      return readEntries(tx, request, bot, actor);
    if (operation === "intro.read" || operation === "intro.save") {
      const row = await tx
        .selectFrom("communication_intro")
        .selectAll()
        .where("bot_identity", "=", bot)
        .executeTakeFirst();
      if (row && row.owner_account_ref !== actor)
        throw new CommunicationsError("not_found");
      const old = row?.snapshot;
      if (operation === "intro.read") {
        if (!old) throw new CommunicationsError("not_found");
        return { intro: old };
      }
      if ((old?.revision ?? 0) !== expectedRevision)
        throw new CommunicationsError("revision_conflict");
      if (old && old.introId !== payload.introId)
        throw new CommunicationsError("revision_conflict");
      validateParts(requiredField(payload.parts));
      const intro: IntroSnapshot = {
        introId: requiredField(payload.introId),
        revision: expectedRevision + 1,
        parts: requiredField(payload.parts),
      };
      await tx
        .insertInto("communication_intro")
        .values({
          bot_identity: bot,
          owner_account_ref: actor,
          snapshot: JSON.stringify(intro),
        })
        .onConflict((c) =>
          c
            .column("bot_identity")
            .doUpdateSet({ snapshot: JSON.stringify(intro) }),
        )
        .execute();
      return { intro };
    }
    if (operation === "sequences.list") {
      let query = tx
        .selectFrom("communication_sequences")
        .selectAll()
        .where("bot_identity", "=", bot)
        .where("owner_account_ref", "=", actor);
      if (hasText(payload.cursor))
        query = query.where("sequence_id", ">", requireCursor(payload.cursor));
      const rows = await query.orderBy("sequence_id").limit(101).execute();
      return {
        sequences: rows.slice(0, 100).map(sequenceView),
        nextCursor: nextCursor(rows, 100, (row) => row.sequence_id),
      };
    }
    if (operation === "deliveries.read") {
      let query = tx
        .selectFrom("communication_deliveries as d")
        .leftJoin(
          "communication_sequences as f",
          "f.sequence_id",
          "d.sequence_id",
        )
        .leftJoin(
          "communication_broadcasts as b",
          "b.broadcast_id",
          "d.broadcast_id",
        )
        .leftJoin(
          "communication_intro as i",
          "i.bot_identity",
          "d.bot_identity",
        )
        .selectAll("d")
        .where("d.bot_identity", "=", bot)
        .where(deliveryOwnerPredicate(actor));
      if (hasText(payload.sequenceId))
        query = query.where("d.sequence_id", "=", payload.sequenceId);
      if (hasText(payload.deliveryId))
        query = query.where("d.delivery_id", "=", payload.deliveryId);
      if (hasText(payload.broadcastId))
        query = query.where("d.broadcast_id", "=", payload.broadcastId);
      if (hasText(payload.cursor))
        query = query.where(
          "d.delivery_id",
          ">",
          requireCursor(payload.cursor),
        );
      const rows = await query.orderBy("d.delivery_id").limit(101).execute();
      return {
        deliveries: rows.slice(0, 100).map(deliveryView),
        nextCursor: nextCursor(rows, 100, (row) => row.delivery_id),
      };
    }
    if (operation === "delivery.resolve") {
      // The decision is serialized with this contact's own commands, claim and result.
      await lockDeliveryContact(tx, bot, requiredField(payload.deliveryId));
      const row = await tx
        .selectFrom("communication_deliveries as d")
        .leftJoin(
          "communication_sequences as f",
          "f.sequence_id",
          "d.sequence_id",
        )
        .leftJoin(
          "communication_broadcasts as b",
          "b.broadcast_id",
          "d.broadcast_id",
        )
        .leftJoin(
          "communication_intro as i",
          "i.bot_identity",
          "d.bot_identity",
        )
        .selectAll("d")
        .where("d.delivery_id", "=", requiredField(payload.deliveryId))
        .where("d.bot_identity", "=", bot)
        .where(deliveryOwnerPredicate(actor))
        .executeTakeFirst();
      if (!row) throw new CommunicationsError("not_found");
      if (row.revision !== expectedRevision || row.completed_at)
        throw new CommunicationsError("revision_conflict");
      const parts = row.parts;
      const part = parts.find((p) => p.partId === payload.partId);
      if (!part || !["unknown", "failed"].includes(part.state))
        throw new CommunicationsError("revision_conflict");
      if (payload.action === "retry") {
        if (
          row.cancel_requested ||
          part.attempts.length >= 90 ||
          (part.state === "unknown" && !isTruthy(payload.duplicateRiskAccepted))
        )
          throw new CommunicationsError("revision_conflict");
        part.state = "pending";
        part.diagnosticCode = isTruthy(payload.duplicateRiskAccepted)
          ? "explicit_retry_duplicate_risk"
          : "explicit_retry";
      } else {
        part.state = "skipped";
        part.diagnosticCode = "operator_skip";
      }
      const updated = await tx
        .updateTable("communication_deliveries")
        .set({
          parts: JSON.stringify(parts),
          revision: row.revision + 1,
          completed_at: terminal(parts) ? this.clock.now() : null,
          due_at: this.clock.now(),
          attempt_id: null,
          locked_at: null,
        })
        .where("delivery_id", "=", row.delivery_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (updated.completed_at)
        await reconcileSequences(tx, bot, this.clock.now(), {
          contactId: updated.contact_id,
        });
      return {
        deliveryId: updated.delivery_id,
        partId: part.partId,
        outcome: payload.action === "retry" ? "retry_requested" : "skipped",
      };
    }
    if (
      ![
        "sequences.rollback",
        "sequences.preview",
        "sequences.save",
        "sequences.read",
        "sequences.publish",
        "sequences.lifecycle",
      ].includes(operation)
    )
      throw new CommunicationsError("not_implemented");
    const existing = await tx
      .selectFrom("communication_sequences")
      .selectAll()
      .where("sequence_id", "=", requiredField(payload.sequenceId))
      .executeTakeFirst();
    if (
      existing &&
      (existing.bot_identity !== bot || existing.owner_account_ref !== actor)
    )
      throw new CommunicationsError("not_found");
    if (operation === "sequences.read") {
      if (!existing) throw new CommunicationsError("not_found");
      return { sequence: sequenceView(existing) };
    }
    if ((existing?.revision ?? 0) !== expectedRevision)
      throw new CommunicationsError("revision_conflict");
    if (operation === "sequences.save") {
      const draft: CommunicationSequenceDraft = {
        sequenceId: requiredField(payload.sequenceId),
        name: requiredField(payload.name),
        steps: requiredField(payload.steps),
        sources: requiredField(payload.sources),
        isDefault: requiredField(payload.isDefault),
        entryResponse: requiredField(payload.entryResponse),
      };
      unique([draft.entryResponse.stepId, ...draft.steps.map((s) => s.stepId)]);
      const allParts = [draft.entryResponse, ...draft.steps].flatMap(
        (s) => s.parts,
      );
      validateParts(allParts);
      unique(draft.sources.map((s) => s.sourceId));
      unique(draft.sources.map((s) => s.code));
      // Legacy auth tokens own the complete 43–64 character base64url namespace.
      if (draft.sources.some((s) => s.code.length >= 43))
        throw new CommunicationsError("malformed");
      const revision = expectedRevision + 1;
      await tx
        .insertInto("communication_sequences")
        .values({
          sequence_id: draft.sequenceId,
          bot_identity: bot,
          owner_account_ref: actor,
          revision,
          published_revision: null,
          lifecycle: "draft",
          draft: JSON.stringify(draft),
          published: null,
          is_default: false,
        })
        .onConflict((c) =>
          c
            .column("sequence_id")
            .doUpdateSet({ revision, draft: JSON.stringify(draft) }),
        )
        .execute();
      for (const source of draft.sources) {
        const reserved = await tx
          .selectFrom("communication_sources")
          .selectAll()
          .where("bot_identity", "=", bot)
          .where((eb) =>
            eb.or([
              eb("source_id", "=", source.sourceId),
              eb("code", "=", source.code),
            ]),
          )
          .execute();
        if (
          reserved.some(
            (r) =>
              r.sequence_id !== draft.sequenceId ||
              r.source_id !== source.sourceId ||
              r.code !== source.code,
          )
        )
          throw new CommunicationsError("revision_conflict");
        await tx
          .insertInto("communication_sources")
          .values({
            bot_identity: bot,
            source_id: source.sourceId,
            code: source.code,
            sequence_id: draft.sequenceId,
          })
          .onConflict((c) => c.doNothing())
          .execute();
      }
      return {
        sequence: {
          ...draft,
          revision,
          publishedRevision: existing?.published_revision ?? null,
          lifecycle: existing?.lifecycle ?? "draft",
        },
      };
    }
    if (!existing) throw new CommunicationsError("not_found");
    if (operation === "sequences.preview") {
      return {
        preview: await previewSequence(
          tx,
          bot,
          existing.draft,
          existing.published,
          existing.revision,
        ),
      };
    }
    if (operation === "sequences.lifecycle") {
      const action = payload.action;
      if (
        (action !== "pause" &&
          action !== "resume" &&
          action !== "archive" &&
          action !== "restore") ||
        (!existing.published && action !== "archive" && action !== "restore")
      )
        throw new CommunicationsError("revision_conflict");
      const lifecycle: "draft" | "published" | "paused" | "archived" =
        !existing.published && action === "restore"
          ? "draft"
          : LIFECYCLE_AFTER[action];
      await tx
        .updateTable("communication_sequences")
        .set({ lifecycle, revision: expectedRevision + 1 })
        .where("sequence_id", "=", existing.sequence_id)
        .execute();
      return {
        sequence: {
          ...sequenceView(existing),
          lifecycle,
          revision: expectedRevision + 1,
        },
      };
    }
    let draft = existing.draft;
    const rollback = operation === "sequences.rollback";
    if (rollback) {
      const publication = await tx
        .selectFrom("communication_publications")
        .select("snapshot")
        .where("sequence_id", "=", existing.sequence_id)
        .where("revision", "=", requiredField(payload.publishedRevision))
        .executeTakeFirst();
      if (!publication) throw new CommunicationsError("not_found");
      draft = decodeStoredSequenceDraft(publication.snapshot);
      // Validate the immutable historical snapshot under the definition lock. Receipts and
      // expectedRevision were checked first, so replay never re-publishes changed content.
      const validation = await validateAuthorContent(
        this.contentValidation,
        { kind: "account", accountRef: actor },
        [draft.entryResponse, ...draft.steps].flatMap((step) => step.parts),
      );
      if (validation.status !== "ok")
        throw new CommunicationsError(
          validation.status === "denied"
            ? "forbidden"
            : "authorization_unavailable",
        );
      if (isTruthy(validation.targetErrors.length))
        throw new CommunicationsError("unsupported_content");
    }
    const previous = existing.published;
    const intro = await tx
      .selectFrom("communication_intro")
      .select("snapshot")
      .where("bot_identity", "=", bot)
      .executeTakeFirst();
    if (!intro) throw new CommunicationsError("revision_conflict");
    const now = this.clock.now();
    const historicalSteps = await tx
      .selectFrom("communication_step_ids")
      .selectAll()
      .where("sequence_id", "=", draft.sequenceId)
      .execute();
    if (
      previous &&
      (previous.entryResponse.stepId !== draft.entryResponse.stepId ||
        draft.steps.some((s) => s.stepId === previous.entryResponse.stepId))
    )
      throw new CommunicationsError("revision_conflict");
    for (const step of [draft.entryResponse, ...draft.steps]) {
      const saved = await tx
        .selectFrom("communication_step_ids")
        .selectAll()
        .where("sequence_id", "=", draft.sequenceId)
        .where("step_id", "=", step.stepId)
        .executeTakeFirst();
      if (
        saved &&
        !rollback &&
        previous &&
        ![previous.entryResponse, ...previous.steps].some(
          (s) => s.stepId === step.stepId,
        )
      )
        throw new CommunicationsError("revision_conflict");
      if (
        historicalSteps.some(
          (s) =>
            s.step_id !== step.stepId &&
            s.part_ids.some((id) => step.parts.some((p) => p.partId === id)),
        )
      )
        throw new CommunicationsError("revision_conflict");
      const partIds = [
        ...new Set([
          ...(saved?.part_ids ?? []),
          ...step.parts.map((p) => p.partId),
        ]),
      ];
      await tx
        .insertInto("communication_step_ids")
        .values({
          sequence_id: draft.sequenceId,
          step_id: step.stepId,
          first_published_at: now,
          part_ids: JSON.stringify(partIds),
        })
        .onConflict((c) =>
          c
            .columns(["sequence_id", "step_id"])
            .doUpdateSet({ part_ids: JSON.stringify(partIds) }),
        )
        .execute();
    }
    if (draft.isDefault)
      await tx
        .updateTable("communication_sequences")
        .set({ is_default: false })
        .where("bot_identity", "=", bot)
        .where("is_default", "=", true)
        .execute();
    const revision = expectedRevision + 1;
    await tx
      .insertInto("communication_publications")
      .values({
        sequence_id: draft.sequenceId,
        revision,
        snapshot: JSON.stringify(draft),
        published_at: now,
      })
      .execute();
    await tx
      .updateTable("communication_sequences")
      .set({
        revision,
        published_revision: revision,
        published: JSON.stringify(draft),
        ...(rollback ? { draft: JSON.stringify(draft) } : {}),
        lifecycle: "published",
        is_default: draft.isDefault,
      })
      .where("sequence_id", "=", draft.sequenceId)
      .execute();
    if (rollback) {
      // Only never-attempted deletion cancellations can return. Sent, skipped and
      // subscriber suppression remain durable markers across every revision.
      const revivable = tx
        .selectFrom("communication_deliveries")
        .where("sequence_id", "=", draft.sequenceId)
        .where("cancel_requested", "=", true);
      await lockContactRows(
        tx,
        (await revivable.select("contact_id").execute()).map(
          (d) => d.contact_id,
        ),
      );
      const cancelled = await revivable.selectAll().execute();
      for (const delivery of cancelled) {
        const parts = delivery.parts;
        if (
          draft.steps.some((s) => s.stepId === delivery.step_id) &&
          parts.every(
            (p) =>
              p.state === "cancelled" &&
              p.diagnosticCode === "step_deleted" &&
              p.attempts.length === 0,
          )
        )
          await tx
            .updateTable("communication_deliveries")
            .set({
              completed_at: null,
              cancel_requested: false,
              parts: JSON.stringify(
                parts.map((p) => ({
                  ...p,
                  state: "pending",
                  diagnosticCode: null,
                })),
              ),
              revision: delivery.revision + 1,
            })
            .where("delivery_id", "=", delivery.delivery_id)
            .execute();
      }
    }
    await reconcileSequences(tx, bot, now, { sequenceId: draft.sequenceId });
    return {
      sequence: {
        ...draft,
        revision,
        publishedRevision: revision,
        lifecycle: "published",
      },
    };
  }
}
function sequenceView(row: {
  draft: CommunicationSequenceDraft;
  revision: number;
  published_revision: number | null;
  lifecycle: CommunicationSequenceSnapshot["lifecycle"];
}): CommunicationSequenceSnapshot {
  return {
    ...decodeStoredSequenceDraft(row.draft),
    revision: row.revision,
    publishedRevision: row.published_revision,
    lifecycle: row.lifecycle,
  };
}
function unique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length)
    throw new CommunicationsError("malformed");
}
function validateParts(parts: readonly MessagePart[]): void {
  unique(parts.map((p) => p.partId));
  for (const part of parts) validateContent(part.content);
}
function requireCursor(cursor: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cursor,
    )
  )
    throw new CommunicationsError("malformed");
  return cursor;
}
