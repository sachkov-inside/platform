import {
  CommunityDiscussionBudget,
  DiscussionBudgetExceeded,
  type DiscussionRun,
} from "./community-discussion-budget.js";
import { z } from "zod";
import { COMMUNITY_FILES, type CommunityFiles } from "./community-files.js";
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Selectable } from "kysely";
import { DATABASE, type Database } from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
import { CommunityMessages } from "./community-messages.js";
import {
  COMMUNITY_DISCUSSION_MODEL,
  groupingOutputSchema,
  type CommunityDiscussionModel,
  type GroupInput,
  type GroupingOutput,
} from "./discussion-model.js";
import type { CommunityMessageTables } from "./community-message-storage.js";

const DAY_MS = 86_400_000;
const RETRY_MS = 300_000;
const LEASE_MS = 180_000;
const PROVIDER_TIMEOUT_MS = 120_000;
// Twenty sequential five-second author callbacks fit within the three-minute lease.
const AUTHOR_PAGE = 20;
const MESSAGE_BATCH = 200;
const RECENT_DAYS = 7;
const CONTEXT_LIMIT = 200;
type Message = Selectable<CommunityMessageTables["community_messages"]>;
export interface DiscussionProcessingResult {
  readonly status:
    | "completed"
    | "not_due"
    | "disabled"
    | "unconfigured"
    | "failed"
    | "budget_exceeded";
  readonly messages: number;
  readonly discussions: number;
  readonly transcriptions: number;
  readonly transcriptionErrors: number;
  readonly failureCode?: string;
}

@Injectable()
export class CommunityDiscussionProcessor {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CommunityMessages) private readonly messages: CommunityMessages,
    @Inject(COMMUNITY_DISCUSSION_MODEL)
    private readonly model: CommunityDiscussionModel,
    @Inject(COMMUNITY_FILES) private readonly files: CommunityFiles,
    @Inject(CommunityDiscussionBudget)
    private readonly budget: CommunityDiscussionBudget,
  ) {}

  async processDue(signal?: AbortSignal): Promise<DiscussionProcessingResult> {
    const empty = {
      messages: 0,
      discussions: 0,
      transcriptions: 0,
      transcriptionErrors: 0,
    };
    if (!this.config.communityDiscussions?.grouping) {
      const status = this.config.communityDiscussions
        ? "unconfigured"
        : "disabled";
      await this.budget.persistRun({ ...empty, status, errors: 0, skips: 1 });
      return { ...empty, status };
    }
    const now = this.clock.now();
    const token = randomUUID();
    await this.database
      .insertInto("community_discussion_schedule")
      .values({
        bot_identity: this.config.botIdentity,
        next_run_at: now,
        lease_token: null,
        lease_until: null,
      })
      .onConflict((conflict) => conflict.column("bot_identity").doNothing())
      .execute();
    const claim = await this.database
      .updateTable("community_discussion_schedule")
      .set({
        lease_token: token,
        lease_until: new Date(now.getTime() + LEASE_MS),
      })
      .where("bot_identity", "=", this.config.botIdentity)
      .where("next_run_at", "<=", now)
      .where((eb) =>
        eb.or([
          eb("budget_blocked_limit", "is", null),
          eb(
            "budget_blocked_limit",
            "!=",
            String(
              this.config.communityDiscussions?.budget.monthlyLimitMicroUsd ??
                0,
            ),
          ),
          eb("budget_blocked_month", "!=", now.toISOString().slice(0, 7)),
        ]),
      )
      .where((eb) =>
        eb.or([eb("lease_until", "is", null), eb("lease_until", "<=", now)]),
      )
      .returning("bot_identity")
      .executeTakeFirst();
    if (!claim) {
      const blocked = await this.database
        .selectFrom("community_discussion_schedule")
        .select("budget_blocked_limit")
        .where("bot_identity", "=", this.config.botIdentity)
        .executeTakeFirst();
      if (
        blocked?.budget_blocked_limit !== null &&
        blocked?.budget_blocked_limit !== undefined
      )
        await this.budget.retryNotification();
      return { ...empty, status: "not_due" };
    }
    let count = 0;
    let discussions = 0;
    const audio = { transcriptions: 0, transcriptionErrors: 0 };
    try {
      await this.budget.assertAvailable();
      if (this.config.communityDiscussions.transcription)
        await this.transcribePending(token, audio, signal);
      // A finite snapshot prevents an active group from extending today's run without a bound.
      const upper = await this.pending()
        .select("message_id")
        .orderBy("message_id", "desc")
        .executeTakeFirst();
      if (upper) {
        let after: string | undefined;
        do {
          signal?.throwIfAborted();
          await this.renew(token);
          const resolved = await this.messages.resolveAuthors({
            limit: AUTHOR_PAGE,
            through: upper.message_id,
            ...(signal ? { signal } : {}),
            ...(after !== undefined ? { after } : {}),
          });
          after = resolved.nextAfter ?? undefined;
        } while (after !== undefined);
        for (;;) {
          signal?.throwIfAborted();
          await this.renew(token);
          const batch = await this.pending()
            .selectAll()
            .where("is_author", "is not", null)
            .where("message_id", "<=", upper.message_id)
            .orderBy("message_id")
            .limit(MESSAGE_BATCH)
            .execute();
          if (batch.length === 0) break;
          const input = await this.modelInput(batch, now);
          const response = await this.model.group(
            input,
            signal
              ? AbortSignal.any([
                  signal,
                  AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
                ])
              : AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          );
          const output = groupingOutputSchema.parse({
            discussions: response.discussions,
          });
          this.validateOutput(input, output);
          await this.commit(token, batch, input, output);
          count += batch.length;
          discussions += output.discussions.length;
        }
      }
      const blocked = await this.budget.exhausted();
      const status = blocked ? "budget_exceeded" : "completed";
      await this.finish(
        token,
        blocked ? now : new Date(now.getTime() + DAY_MS),
        {
          status,
          messages: count,
          discussions,
          transcriptions: audio.transcriptions,
          errors: audio.transcriptionErrors,
          skips: blocked ? 1 : 0,
        },
        blocked,
      );
      return { status, messages: count, discussions, ...audio };
    } catch (error) {
      const budgetFailure = error instanceof DiscussionBudgetExceeded;
      const blocked = budgetFailure || (await this.budget.exhausted());
      const status = blocked ? "budget_exceeded" : "failed";
      const failureCode = budgetFailure
        ? undefined
        : reportFailure("community-discussions.process", error);
      await this.finish(
        token,
        blocked
          ? this.clock.now()
          : new Date(this.clock.now().getTime() + RETRY_MS),
        {
          status,
          messages: count,
          discussions,
          transcriptions: audio.transcriptions,
          errors: audio.transcriptionErrors + (budgetFailure ? 0 : 1),
          skips: blocked ? 1 : 0,
        },
        blocked,
      );
      return {
        status,
        messages: count,
        discussions,
        ...audio,
        ...(failureCode !== undefined ? { failureCode } : {}),
      };
    }
  }

  private async transcribePending(
    token: string,
    counts: { transcriptions: number; transcriptionErrors: number },
    signal?: AbortSignal,
  ): Promise<void> {
    const eligible = () =>
      this.database
        .selectFrom("community_messages")
        .where("bot_identity", "=", this.config.botIdentity)
        .where("chat_id", "=", this.config.canonicalChatId)
        .where("kind", "in", ["voice", "video_note"])
        .where("transcript", "is", null);
    const upper = await eligible()
      .select("message_id")
      .orderBy("message_id", "desc")
      .executeTakeFirst();
    if (!upper) return;
    let after: string | undefined;
    for (;;) {
      let query = eligible()
        .selectAll()
        .where("message_id", "<=", upper.message_id);
      if (after !== undefined) query = query.where("message_id", ">", after);
      const batch = await query
        .orderBy("message_id")
        .limit(AUTHOR_PAGE)
        .execute();
      if (batch.length === 0) return;
      for (const message of batch) {
        signal?.throwIfAborted();
        await this.renew(token);
        try {
          await this.budget.assertAvailable();
          if (message.file_id === null) throw new Error("Missing audio file");
          const bytes = await this.files.download(message.file_id, signal);
          const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
          const result = await this.model.transcribe(
            {
              bytes,
              mediaType: message.kind === "voice" ? "audio/ogg" : "video/mp4",
              ...(message.duration_seconds !== null
                ? { durationSeconds: message.duration_seconds }
                : {}),
            },
            signal ? AbortSignal.any([signal, timeout]) : timeout,
          );
          const transcript = z
            .string()
            .trim()
            .min(1)
            .max(16000)
            .parse(result.text);
          const saved = await this.database
            .updateTable("community_messages")
            .set({ transcript, processed_at: null })
            .where("bot_identity", "=", this.config.botIdentity)
            .where("chat_id", "=", this.config.canonicalChatId)
            .where("message_id", "=", message.message_id)
            .where("last_update_id", "=", message.last_update_id)
            .where("transcript", "is", null)
            .executeTakeFirst();
          counts.transcriptions += Number(saved.numUpdatedRows);
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof DiscussionBudgetExceeded) throw error;
          counts.transcriptionErrors++;
          reportFailure("community-discussions.transcribe", error);
        }
      }
      after = batch.at(-1)?.message_id;
    }
  }

  private pending() {
    return this.database
      .selectFrom("community_messages")
      .where("bot_identity", "=", this.config.botIdentity)
      .where("chat_id", "=", this.config.canonicalChatId)
      .where("processed_at", "is", null);
  }
  private async renew(token: string) {
    const now = this.clock.now();
    const renewed = await this.database
      .updateTable("community_discussion_schedule")
      .set({ lease_until: new Date(now.getTime() + LEASE_MS) })
      .where("bot_identity", "=", this.config.botIdentity)
      .where("lease_token", "=", token)
      .where("lease_until", ">", now)
      .executeTakeFirst();
    if (Number(renewed.numUpdatedRows) !== 1)
      throw new DiscussionProcessingFailure("claim_expired");
  }
  private async finish(
    token: string,
    nextRunAt: Date,
    run: DiscussionRun,
    blocked = false,
  ) {
    await this.database.transaction().execute(async (tx) => {
      const result = await tx
        .updateTable("community_discussion_schedule")
        .set({
          lease_token: null,
          lease_until: null,
          next_run_at: nextRunAt,
          budget_blocked_limit: blocked
            ? String(
                this.config.communityDiscussions?.budget.monthlyLimitMicroUsd ??
                  0,
              )
            : null,
          budget_blocked_month: blocked
            ? this.clock.now().toISOString().slice(0, 7)
            : null,
        })
        .where("bot_identity", "=", this.config.botIdentity)
        .where("lease_token", "=", token)
        .returning("bot_identity")
        .executeTakeFirst();
      if (result) await this.budget.persistRun(run, tx);
    });
  }

  private async modelInput(
    batch: readonly Message[],
    now: Date,
  ): Promise<GroupInput> {
    const referencedIds = [
      ...new Set(
        batch.flatMap((message) => [
          message.message_id,
          ...(message.reply_to_message_id !== null
            ? [message.reply_to_message_id]
            : []),
        ]),
      ),
    ];
    const referenced = await this.database
      .selectFrom("community_discussion_sources")
      .select("discussion_id")
      .where("bot_identity", "=", this.config.botIdentity)
      .where("chat_id", "=", this.config.canonicalChatId)
      .where("message_id", "in", referencedIds)
      .execute();
    const discussionIds = [
      ...new Set(referenced.map((source) => source.discussion_id)),
    ];
    const recent = await this.database
      .selectFrom("community_discussions")
      .select(["id", "question", "answers", "conclusion"])
      .where("bot_identity", "=", this.config.botIdentity)
      .where("chat_id", "=", this.config.canonicalChatId)
      .where((eb) => {
        const open = eb.and([
          eb("status", "in", ["new", "awaiting_answer"]),
          eb(
            "updated_at",
            ">=",
            new Date(now.getTime() - RECENT_DAYS * DAY_MS),
          ),
        ]);
        return discussionIds.length > 0
          ? eb.or([open, eb("id", "in", discussionIds)])
          : open;
      })
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .limit(CONTEXT_LIMIT + 1)
      .execute();
    if (recent.length > CONTEXT_LIMIT)
      throw new DiscussionProcessingFailure("discussion_context_limit");
    const sources =
      recent.length > 0
        ? await this.database
            .selectFrom("community_discussion_sources")
            .select(["discussion_id", "message_id"])
            .where("bot_identity", "=", this.config.botIdentity)
            .where("chat_id", "=", this.config.canonicalChatId)
            .where(
              "discussion_id",
              "in",
              recent.map((row) => row.id),
            )
            .limit(2001)
            .execute()
        : [];
    if (sources.length > 2000)
      throw new DiscussionProcessingFailure("source_context_limit");
    const participants = new Map<string, string>();
    return {
      messages: batch.map((message) => {
        let role = "автор";
        if (message.is_author !== true) {
          role =
            participants.get(message.sender_telegram_user_id) ??
            `участник ${participants.size + 1}`;
          participants.set(message.sender_telegram_user_id, role);
        }
        return {
          messageId: message.message_id,
          threadId: message.thread_id,
          replyToMessageId: message.reply_to_message_id,
          sentAt: message.sent_at.toISOString(),
          role,
          kind: message.kind,
          text:
            message.transcript ??
            (message.kind === "voice"
              ? "[Голосовое сообщение без расшифровки]"
              : message.kind === "video_note"
                ? "[Кружок без расшифровки]"
                : message.text),
        };
      }),
      discussions: recent.map((row) => ({
        discussionId: row.id,
        question: row.question,
        answers: row.answers,
        conclusion: row.conclusion,
        messageIds: sources
          .filter((source) => source.discussion_id === row.id)
          .map((source) => source.message_id),
      })),
    };
  }

  private validateOutput(input: GroupInput, output: GroupingOutput): void {
    const knownMessages = new Set(
      input.messages.map((message) => message.messageId),
    );
    const knownDiscussions = new Set(
      input.discussions.map((discussion) => discussion.discussionId),
    );
    const assigned = new Set<string>();
    const updated = new Set<string>();
    for (const discussion of output.discussions) {
      if (discussion.discussionId !== null) {
        if (
          !knownDiscussions.has(discussion.discussionId) ||
          updated.has(discussion.discussionId)
        )
          throw new DiscussionProcessingFailure(
            "invalid_discussion_assignment",
          );
        updated.add(discussion.discussionId);
      }
      for (const id of discussion.messageIds) {
        if (!knownMessages.has(id) || assigned.has(id))
          throw new DiscussionProcessingFailure("invalid_message_assignment");
        const existing = input.discussions.find((candidate) =>
          candidate.messageIds.includes(id),
        );
        const replyId = input.messages.find(
          (message) => message.messageId === id,
        )?.replyToMessageId;
        const replyDiscussion =
          replyId !== null && replyId !== undefined
            ? input.discussions.find((candidate) =>
                candidate.messageIds.includes(replyId),
              )
            : undefined;
        if (
          (existing && existing.discussionId !== discussion.discussionId) ||
          (replyDiscussion &&
            replyDiscussion.discussionId !== discussion.discussionId)
        )
          throw new DiscussionProcessingFailure("invalid_membership_change");
        assigned.add(id);
      }
    }
    for (const message of input.messages) {
      if (
        input.discussions.some((discussion) =>
          discussion.messageIds.includes(message.messageId),
        ) &&
        !assigned.has(message.messageId)
      )
        throw new DiscussionProcessingFailure("omitted_edited_source");
    }
  }

  private async commit(
    token: string,
    batch: readonly Message[],
    input: GroupInput,
    output: GroupingOutput,
  ): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      const now = this.clock.now();
      const lease = await tx
        .selectFrom("community_discussion_schedule")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .where("lease_token", "=", token)
        .where("lease_until", ">", now)
        .forUpdate()
        .executeTakeFirst();
      if (!lease)
        throw new DiscussionProcessingFailure("claim_expired_before_commit");
      const current = await tx
        .selectFrom("community_messages")
        .select(["message_id", "last_update_id", "processed_at"])
        .where("bot_identity", "=", this.config.botIdentity)
        .where("chat_id", "=", this.config.canonicalChatId)
        .where(
          "message_id",
          "in",
          batch.map((message) => message.message_id),
        )
        .orderBy("message_id")
        .forUpdate()
        .execute();
      if (
        current.length !== batch.length ||
        current.some(
          (message, index) =>
            message.processed_at !== null ||
            message.last_update_id !== batch[index]?.last_update_id,
        )
      )
        throw new DiscussionProcessingFailure("message_snapshot_changed");
      for (const discussion of output.discussions) {
        const id = discussion.discussionId ?? randomUUID();
        const summary = {
          question: discussion.question,
          answers: discussion.answers,
          conclusion: discussion.conclusion,
          updated_at: now,
        };
        if (discussion.discussionId === null) {
          await tx
            .insertInto("community_discussions")
            .values({
              id,
              bot_identity: this.config.botIdentity,
              chat_id: this.config.canonicalChatId,
              status: discussion.answered ? "new" : "awaiting_answer",
              ...summary,
              material_urls: "[]",
              created_at: now,
            })
            .execute();
        } else {
          const existing = await tx
            .selectFrom("community_discussions")
            .select("status")
            .where("id", "=", id)
            .where("bot_identity", "=", this.config.botIdentity)
            .where("chat_id", "=", this.config.canonicalChatId)
            .forUpdate()
            .executeTakeFirst();
          if (!existing)
            throw new DiscussionProcessingFailure("discussion_disappeared");
          await tx
            .updateTable("community_discussions")
            .set({
              ...summary,
              status:
                existing.status === "awaiting_answer" && discussion.answered
                  ? "new"
                  : existing.status,
            })
            .where("id", "=", id)
            .execute();
        }
        const assigned = discussion.messageIds.map((messageId) => {
          const message = batch.find(
            (candidate) => candidate.message_id === messageId,
          );
          const modelMessage = input.messages.find(
            (candidate) => candidate.messageId === messageId,
          );
          if (!message || !modelMessage)
            throw new DiscussionProcessingFailure("invalid_message_assignment");
          return {
            discussion_id: id,
            bot_identity: message.bot_identity,
            chat_id: message.chat_id,
            message_id: messageId,
            thread_id: message.thread_id,
            reply_to_message_id: message.reply_to_message_id,
            sent_at: message.sent_at,
            role: modelMessage.role,
            kind: message.kind,
            source_url: `https://t.me/c/${message.chat_id.replace(/^-100/, "")}/${messageId}`,
          };
        });
        await tx
          .insertInto("community_discussion_sources")
          .values(assigned)
          .onConflict((conflict) =>
            conflict
              .columns(["bot_identity", "chat_id", "message_id"])
              .doNothing(),
          )
          .execute();
      }
      // Non-question chatter is deliberately acknowledged with no discussion membership.
      await tx
        .updateTable("community_messages")
        .set({ processed_at: now })
        .where("bot_identity", "=", this.config.botIdentity)
        .where("chat_id", "=", this.config.canonicalChatId)
        .where(
          "message_id",
          "in",
          batch.map((message) => message.message_id),
        )
        .execute();
    });
  }
}

class DiscussionProcessingFailure extends Error {
  constructor(code: string) {
    super(code);
    this.name = code;
  }
}
