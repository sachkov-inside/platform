import { MaterialAnnouncements } from "./material-announcements.js";
import { transactionWithExternalReads } from "../../database/external-reads.js";
import { findPlatformLink } from "../identity-linking/platform-links.js";
import {
  WAITLIST_AUTHORIZATION,
  DisabledWaitlistAuthorization,
  authorizeWaitlist,
  type WaitlistAuthorization,
  type WaitlistQuery,
  type WaitlistMember,
  type WaitlistAuthorizationResult,
} from "./waitlist-authorization.js";
import {
  SIGN_IN_REPLY_ELIGIBILITY,
  type SignInReplyEligibility,
} from "../outbound/sign-in-reply-eligibility.js";
import { botContactRows } from "../bot-contacts/contact-access.js";
import { isTruthy } from "../../shared/truthiness.js";
import { hasText } from "../../shared/text.js";
import { hasDueReply } from "../outbound/start-response-delivery-queue.js";
import { enqueueBroadcastAuthorMenu } from "./author-delivery-menu.js";
import { completeBroadcasts, launchDueBroadcasts } from "./broadcasts.js";
import { trackedContent } from "./communication-tracking.js";
import { blockDeliveryContact } from "./delivery-contactability.js";
export { relativeDue } from "./funnel-timeline.js";
import {
  cancelDelivery,
  reconcileFunnels,
  terminal,
  started,
} from "./funnel-timeline.js";
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { sql, type Selectable, type Transaction } from "kysely";
import {
  DATABASE,
  type Database,
  type DatabaseSchema,
} from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import {
  CLOCK,
  MONOTONIC_CLOCK,
  systemMonotonicClock,
  type MonotonicClock,
  type Clock,
} from "../../shared/clock.js";
import {
  admitTelegramSlot,
  chatLaneBusy,
  deferTelegramSlot,
} from "../outbound/telegram-transport-slots.js";
import type { TelegramDeliveryResult } from "../outbound/telegram-messages.js";
import type { TemplateContent } from "./communications-contract.js";
import {
  COMMUNICATION_TRANSPORT,
  type CommunicationTransport,
} from "./communication-delivery.js";
import {
  lockDeliveryContact,
  schedulerLock,
  tryContactLock,
  trySchedulerLock,
} from "./communication-state.js";
import type { DeliveryPart } from "./funnel-types.js";
import {
  failureCode,
  reportFailure,
} from "../../shared/failure-diagnostics.js";
const REPLY_KINDS = ["intro", "entry", "fallback"] as const;
const BACKLOG_KINDS = ["step", "broadcast"] as const;
type Queue = typeof REPLY_KINDS | typeof BACKLOG_KINDS;
type QueuePosition = { due_at: Date; created_at: Date; delivery_id: string };
type DueDelivery = Selectable<DatabaseSchema["communication_deliveries"]> & {
  private_chat_id: string;
  marketing_enabled: boolean;
};
type WaitlistDispatchQuery = WaitlistQuery & {
  readonly recipient: WaitlistMember;
};
type Claim = {
  startedAt: Date;
  delivery: DueDelivery;
  attemptId: string;
  chatId: string;
  telegramUserId: string;
  content: TemplateContent;
  waitlist?: WaitlistDispatchQuery;
  materialAnnouncement?: string;
  materialPreviewUrl?: string | undefined;
};
// `capacity_busy`: the bot's shared lane or fairness turn refuses every chat, so stop scanning.
// `released`: a locked contact turned out unsendable; commit now so its /start never waits
// for the rest of the scan.
type CandidateOutcome =
  | { kind: "claimed"; claim: Claim }
  | { kind: "skipped" }
  | { kind: "capacity_busy" }
  | { kind: "released" };
const STALE_CLAIM_MS = 60_000;
const WAITLIST_ELIGIBILITY_RETRY_MS = 5_000;
// Includes pool acquisition, local admission and commit, but excludes the fresh Platform read.
const WAITLIST_ADMISSION_BUDGET_MS = 250;
class WaitlistAdmissionExpired extends Error {}
// A claim reads due work in index pages and gives up after a bounded scan, whatever the backlog.
const CLAIM_PAGE = 50;
const CLAIM_SCAN_LIMIT = 500;
@Injectable()
export class FunnelScheduler {
  private resumeAfter = new Map<Queue, QueuePosition>();
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(COMMUNICATION_TRANSPORT)
    private readonly transport: CommunicationTransport,
    @Inject(SIGN_IN_REPLY_ELIGIBILITY)
    private readonly replyEligibility: SignInReplyEligibility,
    @Inject(WAITLIST_AUTHORIZATION)
    private readonly waitlist: WaitlistAuthorization = new DisabledWaitlistAuthorization(),
    @Inject(MONOTONIC_CLOCK)
    private readonly monotonicClock: MonotonicClock = systemMonotonicClock,
    @Optional()
    @Inject(MaterialAnnouncements)
    private readonly materialAnnouncements?: MaterialAnnouncements,
  ) {}
  async assertConfigured(): Promise<void> {
    if (!this.config.marketingEnabled) return;
    const defaultFunnel = await this.database
      .selectFrom("communication_funnels")
      .select("funnel_id")
      .where("bot_identity", "=", this.config.botIdentity)
      .where("is_default", "=", true)
      .where("lifecycle", "=", "published")
      .executeTakeFirst();
    const intro = await this.database
      .selectFrom("communication_intro")
      .select("bot_identity")
      .where("bot_identity", "=", this.config.botIdentity)
      .executeTakeFirst();
    if (!defaultFunnel || !intro)
      throw new Error(
        "Marketing requires a published default funnel and common intro",
      );
  }
  async processAvailable(limit = 25, signal?: AbortSignal): Promise<number> {
    if (isTruthy(signal?.aborted)) return 0;
    await this.plan();
    let processed = 0;
    // A released claim freed a contact that proved unsendable; it only retries, within bounds.
    for (
      let attempts = 0;
      processed < limit && attempts < 2 * limit && !isTruthy(signal?.aborted);
      attempts++
    ) {
      const outcome = await this.claim();
      if (outcome.kind === "released") continue;
      if (outcome.kind !== "claimed") break;
      const claimed = outcome.claim;
      if (claimed.materialAnnouncement !== undefined) {
        const current = await this.materialAnnouncements?.current(
          claimed.materialAnnouncement,
        );
        if (current !== "current") {
          await this.releaseUnsentClaim(claimed, current === "unavailable");
          if (current === "unavailable") break;
          continue;
        }
        const deadline =
          this.monotonicClock.now() + WAITLIST_ADMISSION_BUDGET_MS;
        if (
          !(await this.admitCheckedTransport(claimed, deadline)) ||
          this.monotonicClock.now() >= deadline
        ) {
          await this.releaseUnsentClaim(claimed, true);
          break;
        }
      }
      if (claimed.waitlist !== undefined) {
        // This read follows the committed local claim, so an earlier Platform withdrawal
        // cannot hide in the cached pre-claim answer or a scheduler-lock wait.
        const query = claimed.waitlist;
        let eligibility: WaitlistAuthorizationResult;
        try {
          eligibility = await this.waitlist.read(query);
        } catch (error) {
          reportFailure("communications.waitlist-eligibility", error);
          eligibility = { status: "unavailable" };
        }
        const deadline =
          this.monotonicClock.now() + WAITLIST_ADMISSION_BUDGET_MS;
        const eligible =
          eligibility.status === "ok" &&
          eligibility.saleOpen &&
          eligibility.members.some(
            (member) =>
              member.accountRef === query.recipient.accountRef &&
              member.telegramIdentityRef ===
                query.recipient.telegramIdentityRef,
          ) &&
          claimed.delivery.snapshot.some((part) =>
            part.content.buttons.some(
              (button) => button.url === eligibility.purchaseUrl,
            ),
          );
        if (!eligible) {
          await this.releaseUnsentClaim(
            claimed,
            eligibility.status === "unavailable",
          );
          if (eligibility.status === "unavailable") break;
          continue;
        }
        if (
          !(await this.admitCheckedTransport(claimed, deadline)) ||
          this.monotonicClock.now() >= deadline
        ) {
          await this.releaseUnsentClaim(claimed, true);
          break;
        }
      }
      let result: TelegramDeliveryResult;
      try {
        result = await this.transport.send({
          chatId: claimed.chatId,
          content: claimed.content,
          linkPreviewUrl: claimed.materialPreviewUrl,
          offerStart: claimed.delivery.kind === "fallback",
        });
      } catch (error) {
        reportFailure("communications.funnel-send", error, {
          delivery_id: claimed.delivery.delivery_id,
        });
        result = { kind: "transport_unknown" };
      }
      await this.record(
        claimed.delivery.delivery_id,
        claimed.attemptId,
        result,
        claimed.startedAt,
      );
      processed++;
    }
    return processed;
  }
  // Once per cycle and outside claims: recover lost claims, launch armed broadcasts and complete
  // finished ones. Funnel timelines are replanned by the events that change them, so no claim
  // scans the audience.
  private async plan(): Promise<void> {
    await this.materialAnnouncements?.plan();
    const bot = this.config.botIdentity;
    await this.database.transaction().execute(async (tx) => {
      await schedulerLock(tx, bot);
      const now = this.clock.now();
      const stale = await tx
        .selectFrom("communication_deliveries as d")
        .innerJoin(
          "communication_contacts as c",
          "c.contact_id",
          "d.contact_id",
        )
        .select(["d.delivery_id", "c.telegram_user_id"])
        .where("d.bot_identity", "=", bot)
        .where("d.completed_at", "is", null)
        .where("d.locked_at", "<=", new Date(now.getTime() - STALE_CLAIM_MS))
        .orderBy("d.locked_at")
        .limit(CLAIM_PAGE)
        .execute();
      for (const { delivery_id, telegram_user_id } of stale) {
        // A contact busy with /start keeps its lock; the next cycle recovers the claim.
        if (!(await tryContactLock(tx, bot, telegram_user_id))) continue;
        const delivery = await tx
          .selectFrom("communication_deliveries")
          .selectAll()
          .where("delivery_id", "=", delivery_id)
          .where("completed_at", "is", null)
          .where("locked_at", "<=", new Date(now.getTime() - STALE_CLAIM_MS))
          .executeTakeFirst();
        if (!delivery) continue;
        const parts = delivery.parts;
        const part = parts.find((p) => p.state === "in_flight");
        // A claim writes attempt_id and locked_at together with the in-flight part; the query
        // selects only locked rows, so the attempt is recorded whenever the part is.
        const { attempt_id: attemptId, locked_at: lockedAt } = delivery;
        if (part) {
          part.state = "unknown";
          part.diagnosticCode = "worker_lost";
        }
        if (part && attemptId !== null && lockedAt !== null) {
          part.attempts.push({
            attemptId,
            attemptedAt: lockedAt.toISOString(),
            outcome: "unknown",
            diagnosticCode: "worker_lost",
            duplicateRiskAccepted: false,
          });
        }
        // The attempt ID stays for late evidence; the lease itself is spent.
        await tx
          .updateTable("communication_deliveries")
          .set({
            parts: JSON.stringify(parts),
            revision: delivery.revision + (part ? 1 : 0),
            locked_at: null,
          })
          .where("delivery_id", "=", delivery.delivery_id)
          .execute();
      }
    });
    // A separate transaction: a large launch must not hold the recovered contacts' locks.
    await transactionWithExternalReads(this.database, async (tx) => {
      await schedulerLock(tx, bot);
      const now = this.clock.now();
      await launchDueBroadcasts(
        tx,
        bot,
        now,
        this.waitlist,
        this.config.marketingEnabled,
      );
      await completeBroadcasts(tx, bot);
    });
  }
  // Eligibility that SQL can decide, shared by the bounded scan and the locked reread.
  private dueDeliveries(tx: Transaction<DatabaseSchema>, now: Date) {
    let query = tx
      .selectFrom("communication_deliveries as d")
      .innerJoin("communication_contacts as c", "c.contact_id", "d.contact_id")
      .innerJoin(botContactRows(tx).as("b"), (j) =>
        j
          .onRef("b.bot_identity", "=", "c.bot_identity")
          .onRef("b.telegram_user_id", "=", "c.telegram_user_id"),
      )
      .where("d.bot_identity", "=", this.config.botIdentity)
      .where("d.completed_at", "is", null)
      .where("d.due_at", "<=", now)
      .where("d.cancel_requested", "=", false)
      // A part awaiting its result or an operator decision holds the whole delivery.
      .where(
        sql<boolean>`not (d.parts @> '[{"state":"in_flight"}]' or d.parts @> '[{"state":"unknown"}]' or d.parts @> '[{"state":"failed"}]')`,
      )
      .where((eb) =>
        eb.or([
          eb("c.marketing_enabled", "=", true),
          eb("d.kind", "in", ["entry", "fallback"]),
        ]),
      )
      .where("b.contactability", "=", "reachable")
      .where((eb) =>
        eb.or([
          eb("d.broadcast_id", "is", null),
          eb.exists(
            eb
              .selectFrom("communication_broadcasts as r")
              .select("r.broadcast_id")
              .whereRef("r.broadcast_id", "=", "d.broadcast_id")
              .where("r.state", "=", "running"),
          ),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb("d.funnel_id", "is", null),
          eb.exists(
            eb
              .selectFrom("communication_funnels as f")
              .select("f.funnel_id")
              .whereRef("f.funnel_id", "=", "d.funnel_id")
              .where("f.lifecycle", "=", "published"),
          ),
        ]),
      );
    if (!this.config.marketingEnabled)
      query = query.where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom("communication_material_announcements as m")
              .select("m.broadcast_id")
              .whereRef("m.broadcast_id", "=", "d.broadcast_id")
              .where("m.bot_identity", "=", this.config.botIdentity)
              .where(
                "m.audience_key",
                "=",
                this.materialAnnouncements?.audienceKey() ?? "disabled",
              ),
          ),
          eb.exists(
            eb
              .selectFrom("communication_waitlist_recipients as w")
              .select("w.contact_id")
              .whereRef("w.broadcast_id", "=", "d.broadcast_id")
              .whereRef("w.contact_id", "=", "d.contact_id"),
          ),
        ]),
      );
    return query;
  }
  private async claim(): Promise<CandidateOutcome> {
    // Scan positions advance only when the claim transaction commits.
    const resumeAfter = new Map(this.resumeAfter);
    const outcome = await transactionWithExternalReads(
      this.database,
      async (tx) => {
        await schedulerLock(tx, this.config.botIdentity);
        const now = this.clock.now();
        // A marketing backlog must never reserve capacity ahead of a ready service response.
        if (
          await hasDueReply(
            tx,
            this.config.botIdentity,
            now,
            this.config.signInEnabled === true,
            this.replyEligibility,
          )
        )
          return { kind: "capacity_busy" } as const;
        // Replies to a contact's own /start go ahead of the funnel and broadcast backlog.
        for (const queue of [REPLY_KINDS, BACKLOG_KINDS]) {
          const outcome = await this.claimFrom(tx, resumeAfter, queue, now);
          if (outcome.kind !== "skipped") return outcome;
        }
        return { kind: "skipped" } as const;
      },
    );
    this.resumeAfter = resumeAfter;
    return outcome;
  }
  // Scans one queue in due order, at most CLAIM_SCAN_LIMIT rows per claim. When that many rows
  // at the head cannot be sent (a lane waiting for an earlier step, an intro not yet sent), the
  // next claims continue after them and wrap at the end, so the head never stalls the queue.
  private async claimFrom(
    tx: Transaction<DatabaseSchema>,
    resumeAfter: Map<Queue, QueuePosition>,
    queue: Queue,
    now: Date,
  ): Promise<CandidateOutcome> {
    const resumed = resumeAfter.get(queue);
    let after = resumed;
    let fromHead = !resumed;
    for (let scanned = 0; scanned < CLAIM_SCAN_LIMIT;) {
      let query = this.dueDeliveries(tx, now)
        .select([
          "d.delivery_id",
          "d.due_at",
          "d.created_at",
          "c.telegram_user_id",
        ])
        // Literal kinds let PostgreSQL match the partial queue index.
        .where(
          sql<boolean>`d.kind in (${sql.join(queue.map((k) => sql.lit(k)))})`,
        );
      if (after)
        query = query.where(
          sql<boolean>`(d.due_at, d.created_at, d.delivery_id) > (${after.due_at}, ${after.created_at}, ${after.delivery_id}::uuid)`,
        );
      const page = await query
        .orderBy("d.due_at")
        .orderBy("d.created_at")
        .orderBy("d.delivery_id")
        .limit(CLAIM_PAGE)
        .execute();
      for (const candidate of page) {
        const outcome = await this.claimCandidate(tx, candidate, now);
        if (outcome.kind === "claimed" && resumed)
          resumeAfter.set(queue, candidate);
        if (outcome.kind !== "skipped") return outcome;
      }
      scanned += page.length;
      if (page.length < CLAIM_PAGE) {
        // The end of the queue: the next claim starts from its head again.
        resumeAfter.delete(queue);
        if (fromHead) return { kind: "skipped" };
        fromHead = true;
        after = undefined;
        continue;
      }
      after = page.at(-1);
    }
    if (after) resumeAfter.set(queue, after);
    return { kind: "skipped" };
  }
  private async claimCandidate(
    tx: Transaction<DatabaseSchema>,
    candidate: { delivery_id: string; telegram_user_id: string },
    now: Date,
  ): Promise<CandidateOutcome> {
    const read = () =>
      this.dueDeliveries(tx, now)
        .selectAll("d")
        .select(["b.private_chat_id", "c.marketing_enabled"])
        .where("d.delivery_id", "=", candidate.delivery_id)
        .executeTakeFirst();
    // Check before locking, so a skipped contact is normally never held; a contact whose /start,
    // stop or entry is in progress is skipped instead of awaited. The locked reread decides.
    const unlocked = await read();
    if (
      !unlocked ||
      (await chatLaneBusy(
        tx,
        this.config.botIdentity,
        unlocked.private_chat_id,
        now,
      )) ||
      !(await this.nextPart(tx, unlocked, now))
    )
      return { kind: "skipped" };
    if (
      !(await tryContactLock(
        tx,
        this.config.botIdentity,
        candidate.telegram_user_id,
      ))
    )
      return { kind: "skipped" };
    const delivery = await read();
    const part = delivery && (await this.nextPart(tx, delivery, now));
    if (!delivery || !part) return { kind: "released" };
    let waitlistQuery: WaitlistDispatchQuery | undefined;
    let materialAnnouncement: string | undefined;
    if (delivery.broadcast_id !== null) {
      const broadcast = await tx
        .selectFrom("communication_broadcasts")
        .selectAll()
        .where("broadcast_id", "=", delivery.broadcast_id)
        .executeTakeFirstOrThrow();
      const materialStatus = await this.materialAnnouncements?.current(
        broadcast.broadcast_id,
        tx,
      );
      if (materialStatus === "unavailable") return { kind: "capacity_busy" };
      if (materialStatus === "withdrawn") {
        await cancelDelivery(
          tx,
          delivery,
          now,
          "material_announcement_withdrawn",
        );
        return { kind: "released" };
      }
      if (materialStatus === "current")
        materialAnnouncement = broadcast.broadcast_id;
      if (broadcast.audience.kind === "waitlist") {
        const recipient = await tx
          .selectFrom("communication_waitlist_recipients")
          .selectAll()
          .where("broadcast_id", "=", broadcast.broadcast_id)
          .where("contact_id", "=", delivery.contact_id)
          .executeTakeFirst();
        const current =
          recipient &&
          (await findPlatformLink(
            tx,
            {
              botIdentity: this.config.botIdentity,
              telegramUserId: candidate.telegram_user_id,
              accountRef: recipient.account_ref,
            },
            "share",
          ));
        if (
          !recipient ||
          current?.telegramIdentityRef !== recipient.telegram_identity_ref
        ) {
          await cancelDelivery(tx, delivery, now, "waitlist_link_changed");
          return { kind: "released" };
        }
        const member = {
          accountRef: recipient.account_ref,
          telegramIdentityRef: recipient.telegram_identity_ref,
        };
        waitlistQuery = {
          actorAccountRef: broadcast.owner_account_ref,
          intakeId: broadcast.audience.intakeId,
          recipient: member,
        };
        const eligibility = await authorizeWaitlist(
          this.waitlist,
          waitlistQuery,
        );
        if (eligibility.status === "unavailable")
          return { kind: "capacity_busy" };
        if (
          eligibility.status !== "ok" ||
          !eligibility.saleOpen ||
          !eligibility.members.some(
            (m) =>
              m.accountRef === member.accountRef &&
              m.telegramIdentityRef === member.telegramIdentityRef,
          ) ||
          !delivery.snapshot.some((p) =>
            p.content.buttons.some((b) => b.url === eligibility.purchaseUrl),
          )
        ) {
          await cancelDelivery(tx, delivery, now, "waitlist_ineligible");
          return { kind: "released" };
        }
      }
    }
    if (waitlistQuery === undefined && materialAnnouncement === undefined) {
      const admission = await admitTelegramSlot(
        tx,
        this.config.botIdentity,
        delivery.private_chat_id,
        now,
      );
      if (admission === "bot_busy") return { kind: "capacity_busy" };
      if (admission === "chat_busy") return { kind: "released" };
    }
    const attemptId = randomUUID();
    const parts = delivery.parts;
    // nextPart returns the element of delivery.parts, so this marks the persisted part.
    part.state = "in_flight";
    await tx
      .updateTable("communication_deliveries")
      .set({
        parts: JSON.stringify(parts),
        attempt_id: attemptId,
        locked_at: now,
        revision: delivery.revision + 1,
      })
      .where("delivery_id", "=", delivery.delivery_id)
      .execute();
    const content = delivery.snapshot.find(
      (p) => p.partId === part.partId,
    )?.content;
    if (!content) throw new Error("Delivery part has no snapshot content");
    return {
      kind: "claimed",
      claim: {
        startedAt: now,
        ...(materialAnnouncement === undefined
          ? {}
          : {
              materialAnnouncement,
              materialPreviewUrl: content.buttons[0]?.url,
            }),
        ...(waitlistQuery === undefined ? {} : { waitlist: waitlistQuery }),
        delivery,
        attemptId,
        chatId: delivery.private_chat_id,
        telegramUserId: candidate.telegram_user_id,
        content: await trackedContent(
          tx,
          this.config,
          delivery.delivery_id,
          part.partId,
          content,
          now,
        ),
      },
    };
  }
  /** Reserve immediately before transport, after all potentially slow Platform reads. */
  private async admitCheckedTransport(
    claim: Claim,
    deadline: number,
  ): Promise<boolean> {
    try {
      return await this.database.transaction().execute(async (tx) => {
        if (this.monotonicClock.now() >= deadline)
          throw new WaitlistAdmissionExpired();
        await sql`set local lock_timeout = '25ms'`.execute(tx);
        await sql`set local statement_timeout = '100ms'`.execute(tx);
        if (!(await trySchedulerLock(tx, this.config.botIdentity)))
          return false;

        if (
          !(await tryContactLock(
            tx,
            this.config.botIdentity,
            claim.telegramUserId,
          ))
        )
          return false;
        const delivery = await tx
          .selectFrom("communication_deliveries as d")
          .innerJoin(
            "communication_contacts as c",
            "c.contact_id",
            "d.contact_id",
          )
          .innerJoin(botContactRows(tx).as("b"), (join) =>
            join
              .onRef("b.bot_identity", "=", "c.bot_identity")
              .onRef("b.telegram_user_id", "=", "c.telegram_user_id"),
          )
          .selectAll("d")
          .select([
            "c.telegram_user_id",
            "c.marketing_enabled",
            "b.contactability",
            "b.private_chat_id",
          ])
          .where("d.bot_identity", "=", this.config.botIdentity)
          .where("d.delivery_id", "=", claim.delivery.delivery_id)
          .executeTakeFirst();
        if (
          !delivery ||
          delivery.attempt_id !== claim.attemptId ||
          !delivery.parts.some((part) => part.state === "in_flight")
        )
          return false;
        const now = this.clock.now();
        const query = claim.waitlist;
        if (query === undefined && claim.materialAnnouncement === undefined)
          return false;
        const binding =
          query === undefined
            ? undefined
            : await findPlatformLink(
                tx,
                {
                  botIdentity: this.config.botIdentity,
                  telegramUserId: delivery.telegram_user_id,
                  accountRef: query.recipient.accountRef,
                },
                "share",
                "nowait",
              );
        if (
          delivery.cancel_requested ||
          !delivery.marketing_enabled ||
          delivery.contactability !== "reachable" ||
          (query !== undefined &&
            binding?.telegramIdentityRef !==
              query.recipient.telegramIdentityRef) ||
          (claim.materialAnnouncement !== undefined &&
            this.materialAnnouncements?.audienceKey() === undefined)
        ) {
          await cancelDelivery(tx, delivery, now, "waitlist_ineligible");
          return false;
        }
        const broadcast = await tx
          .selectFrom("communication_broadcasts")
          .select("state")
          .where("broadcast_id", "=", claim.delivery.broadcast_id)
          .executeTakeFirst();
        if (broadcast?.state !== "running") return false;
        if (
          await hasDueReply(
            tx,
            this.config.botIdentity,
            now,
            this.config.signInEnabled === true,
            this.replyEligibility,
          )
        )
          return false;
        const reserved =
          (await admitTelegramSlot(
            tx,
            this.config.botIdentity,
            delivery.private_chat_id,
            now,
            "general",
            "nowait",
          )) === "reserved";
        if (this.monotonicClock.now() >= deadline)
          throw new WaitlistAdmissionExpired();
        return reserved;
      });
    } catch (error) {
      if (error instanceof WaitlistAdmissionExpired) return false;
      if (["pg_55P03", "pg_57014"].includes(failureCode(error))) {
        reportFailure("communications.waitlist-admission", error);
        return false;
      }
      throw error;
    }
  }
  /** No provider call occurred. Keep outage retries distinct from unknown transport attempts. */
  private async releaseUnsentClaim(
    claim: Claim,
    retry: boolean,
  ): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      await schedulerLock(tx, this.config.botIdentity);
      await lockDeliveryContact(
        tx,
        this.config.botIdentity,
        claim.delivery.delivery_id,
      );
      const delivery = await tx
        .selectFrom("communication_deliveries")
        .selectAll()
        .where("delivery_id", "=", claim.delivery.delivery_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (delivery.attempt_id !== claim.attemptId) return;
      const part = delivery.parts.find((part) => part.state === "in_flight");
      // Recovery may already have classified a lost lease as unknown. Never turn it into a retry.
      if (part === undefined) return;
      const now = this.clock.now();
      part.state =
        retry && !delivery.cancel_requested ? "pending" : "cancelled";
      part.diagnosticCode =
        claim.materialAnnouncement !== undefined
          ? part.state === "pending"
            ? "material_eligibility_unavailable"
            : "material_announcement_withdrawn"
          : part.state === "pending"
            ? "waitlist_eligibility_unavailable"
            : "waitlist_ineligible";
      await tx
        .updateTable("communication_deliveries")
        .set({
          parts: JSON.stringify(delivery.parts),
          revision: delivery.revision + 1,
          attempt_id: null,
          locked_at: null,
          due_at: new Date(now.getTime() + WAITLIST_ELIGIBILITY_RETRY_MS),
          completed_at: terminal(delivery.parts) ? now : null,
        })
        .where("delivery_id", "=", delivery.delivery_id)
        .execute();
      if (delivery.broadcast_id !== null)
        await completeBroadcasts(
          tx,
          this.config.botIdentity,
          delivery.broadcast_id,
        );
    });
  }
  // The part to send now, or undefined while broadcast offsets, the funnel lane or the intro
  // hold this delivery.
  private async nextPart(
    tx: Transaction<DatabaseSchema>,
    delivery: DueDelivery,
    now: Date,
  ): Promise<DeliveryPart | undefined> {
    const part = delivery.parts.find(
      (p) => !["sent", "skipped", "cancelled", "suppressed"].includes(p.state),
    );
    if (part?.state !== "pending" || part.attempts.length >= 90)
      return undefined;
    if (hasText(delivery.broadcast_id)) {
      const broadcast = await tx
        .selectFrom("communication_broadcasts")
        .select(["state", "launched_at"])
        .where("broadcast_id", "=", delivery.broadcast_id)
        .executeTakeFirstOrThrow();
      const offset =
        delivery.snapshot.find((p) => p.partId === part.partId)
          ?.sendAfterSeconds ?? 0;
      if (
        !broadcast.launched_at ||
        +broadcast.launched_at + offset * 1000 > +now
      )
        return undefined;
    }
    if (hasText(delivery.funnel_id)) {
      const funnel = await tx
        .selectFrom("communication_funnels")
        .selectAll()
        .where("funnel_id", "=", delivery.funnel_id)
        .forShare()
        .executeTakeFirstOrThrow();
      if (delivery.kind === "step" && !started(delivery)) {
        const draft = funnel.published;
        if (!draft) return undefined;
        const history = await tx
          .selectFrom("communication_deliveries")
          .selectAll()
          .where("contact_id", "=", delivery.contact_id)
          .where("funnel_id", "=", delivery.funnel_id)
          .execute();
        if (
          history.some(
            (d) => d.kind === "step" && !d.completed_at && started(d),
          )
        )
          return undefined;
        const next = draft.steps.find(
          (s) =>
            !isTruthy(
              history.some(
                (d) =>
                  d.kind === "step" &&
                  d.step_id === s.stepId &&
                  d.completed_at !== null,
              ),
            ),
        );
        if (next?.stepId !== delivery.step_id) return undefined;
      }
      const intro = await tx
        .selectFrom("communication_deliveries")
        .select("completed_at")
        .where("dedup_key", "=", `intro:${delivery.contact_id}`)
        .executeTakeFirst();
      if (delivery.marketing_enabled && !intro?.completed_at) return undefined;
    }
    return part;
  }
  async record(
    deliveryId: string,
    attemptId: string,
    result: TelegramDeliveryResult,
    startedAt?: Date,
  ): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      await schedulerLock(tx, this.config.botIdentity);
      await lockDeliveryContact(tx, this.config.botIdentity, deliveryId);
      const delivery = await tx
        .selectFrom("communication_deliveries")
        .selectAll()
        .where("delivery_id", "=", deliveryId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (delivery.attempt_id !== attemptId) return;
      const parts = delivery.parts;
      const part = parts.find(
        (p) =>
          p.state === "in_flight" ||
          (p.state === "unknown" &&
            p.attempts.some((a) => a.attemptId === attemptId)),
      );
      if (!part) return;
      const now = this.clock.now();
      const code =
        result.kind === "api_rejected" || result.kind === "api_retryable"
          ? `telegram_${result.providerErrorCode}`
          : result.kind === "transport_unknown"
            ? "transport_unknown"
            : null;
      part.attempts.push({
        attemptId,
        attemptedAt: now.toISOString(),
        outcome:
          result.kind === "delivered"
            ? "sent"
            : result.kind === "api_rejected"
              ? "api_rejected"
              : result.kind === "api_retryable"
                ? "retryable"
                : "unknown",
        diagnosticCode: code,
        duplicateRiskAccepted:
          part.diagnosticCode === "explicit_retry_duplicate_risk",
      });
      part.diagnosticCode = code;
      part.state =
        result.kind === "delivered"
          ? "sent"
          : result.kind === "transport_unknown"
            ? "unknown"
            : result.kind === "api_retryable" && part.attempts.length < 3
              ? "pending"
              : "failed";
      if (
        delivery.cancel_requested &&
        ["pending", "failed"].includes(part.state)
      ) {
        const suppressed =
          delivery.kind === "broadcast" &&
          delivery.cancellation_reason === "marketing_unavailable";
        part.state = suppressed ? "suppressed" : "cancelled";
        part.diagnosticCode = suppressed
          ? "marketing_unavailable"
          : "cancel_requested";
      }
      let due =
        result.kind === "api_retryable"
          ? new Date(
              now.getTime() + Math.max(result.retryAfterSeconds ?? 5, 1) * 1000,
            )
          : now;
      if (hasText(delivery.broadcast_id) && result.kind === "delivered") {
        const next = parts.find(
          (p) =>
            !["sent", "skipped", "cancelled", "suppressed"].includes(p.state),
        );
        const offset =
          delivery.snapshot.find((p) => p.partId === next?.partId)
            ?.sendAfterSeconds ?? 0;
        const b = await tx
          .selectFrom("communication_broadcasts")
          .select("launched_at")
          .where("broadcast_id", "=", delivery.broadcast_id)
          .executeTakeFirstOrThrow();
        if (next && b.launched_at)
          due = new Date(Math.max(+now, +b.launched_at + offset * 1000));
      }
      if (result.kind === "api_retryable" && result.providerErrorCode === 429)
        await deferTelegramSlot(tx, this.config.botIdentity, due);
      await tx
        .updateTable("communication_deliveries")
        .set({
          parts: JSON.stringify(parts),
          revision: delivery.revision + 1,
          due_at: due,
          locked_at: null,
          attempt_id: part.state === "unknown" ? attemptId : null,
          completed_at: terminal(parts) ? now : null,
        })
        .where("delivery_id", "=", deliveryId)
        .execute();
      if (result.kind === "api_rejected" && result.providerErrorCode === 403) {
        const contact = await tx
          .selectFrom("communication_contacts")
          .select("telegram_user_id")
          .where("contact_id", "=", delivery.contact_id)
          .executeTakeFirstOrThrow();
        await blockDeliveryContact(
          tx,
          this.config.botIdentity,
          contact.telegram_user_id,
          now,
          startedAt ?? delivery.locked_at ?? new Date(0),
        );
      }
      if (hasText(delivery.broadcast_id))
        await completeBroadcasts(
          tx,
          this.config.botIdentity,
          delivery.broadcast_id,
        );
      // A finished response or step opens the contact's next step.
      else if (terminal(parts))
        await reconcileFunnels(tx, this.config.botIdentity, now, {
          contactId: delivery.contact_id,
        });
      if (
        result.kind === "delivered" &&
        (terminal(parts) || +due > +now) &&
        hasText(delivery.broadcast_id)
      )
        await enqueueBroadcastAuthorMenu(
          tx,
          this.config.botIdentity,
          delivery.broadcast_id,
          delivery.contact_id,
        );
    });
  }
}
