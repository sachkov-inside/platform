import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
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
import { reportFailure } from "../../shared/failure-diagnostics.js";
import { CommunityAuthors } from "../communications/community-authors.js";
import type {
  CommunityDiscussionModel,
  ModelUsage,
} from "./discussion-model.js";

type Operation = "group" | "transcribe";
export interface DiscussionRun {
  readonly status: string;
  readonly messages: number;
  readonly transcriptions: number;
  readonly discussions: number;
  readonly errors: number;
  readonly skips: number;
}
export class DiscussionBudgetExceeded extends Error {
  constructor() {
    super("Community discussion monthly budget reached");
    this.name = "discussion_budget_exceeded";
  }
}

/** Reservations commit before provider I/O. A crash or missing usage keeps its conservative charge. */
@Injectable()
export class CommunityDiscussionBudget {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CommunityAuthors) private readonly authors: CommunityAuthors,
  ) {}

  async call<T extends { readonly usage: ModelUsage }>(
    operation: Operation,
    invoke: () => Promise<T>,
    durationSeconds?: number,
  ): Promise<T> {
    const policy = this.config.communityDiscussions?.budget;
    if (!policy) throw new DiscussionBudgetExceeded();
    const now = this.clock.now();
    const month = now.toISOString().slice(0, 7);
    const fallback =
      operation === "group"
        ? policy.groupingFallbackMicroUsd
        : Math.max(
            policy.transcriptionFallbackMicroUsd,
            audioCost(durationSeconds, policy.transcriptionMicroUsdPerMinute),
          );
    const id = randomUUID();
    const reserved = await this.database.transaction().execute(async (tx) => {
      await tx
        .insertInto("community_discussion_budget_months")
        .values({
          bot_identity: this.config.botIdentity,
          month,
          cost_micro_usd: "0",
          notified: false,
        })
        .onConflict((c) => c.columns(["bot_identity", "month"]).doNothing())
        .execute();
      const total = await tx
        .selectFrom("community_discussion_budget_months")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .where("month", "=", month)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (
        BigInt(total.cost_micro_usd) + BigInt(fallback) >
        BigInt(policy.monthlyLimitMicroUsd)
      )
        return false;
      await tx
        .insertInto("community_discussion_model_calls")
        .values({
          id,
          bot_identity: this.config.botIdentity,
          month,
          operation,
          cost_micro_usd: String(fallback),
          state: "reserved",
          created_at: now,
        })
        .execute();
      await tx
        .updateTable("community_discussion_budget_months")
        .set({
          cost_micro_usd: sql<string>`cost_micro_usd + ${String(fallback)}::bigint`,
        })
        .where("bot_identity", "=", this.config.botIdentity)
        .where("month", "=", month)
        .execute();
      return true;
    });
    if (!reserved) {
      await this.notify(month, now);
      throw new DiscussionBudgetExceeded();
    }
    let response: T;
    try {
      response = await invoke();
    } catch (error) {
      await this.database
        .updateTable("community_discussion_model_calls")
        .set({ state: "failed" })
        .where("id", "=", id)
        .execute();
      if (await this.exhausted()) await this.notify(month, now);
      throw error;
    }
    const usage = response.usage;
    const estimated =
      operation === "group"
        ? tokenCost(usage.inputTokens, policy.inputMicroUsdPerMillionTokens) +
          tokenCost(usage.outputTokens, policy.outputMicroUsdPerMillionTokens)
        : audioCost(
            usage.durationSeconds ?? durationSeconds,
            policy.transcriptionMicroUsdPerMinute,
          );
    const cost = Math.max(
      fallback,
      Math.min(Number.MAX_SAFE_INTEGER, estimated),
    );
    await this.database.transaction().execute(async (tx) => {
      await tx
        .updateTable("community_discussion_budget_months")
        .set({
          cost_micro_usd: sql<string>`cost_micro_usd + ${String(cost - fallback)}::bigint`,
        })
        .where("bot_identity", "=", this.config.botIdentity)
        .where("month", "=", month)
        .execute();
      await tx
        .updateTable("community_discussion_model_calls")
        .set({ cost_micro_usd: String(cost), state: "completed" })
        .where("id", "=", id)
        .execute();
    });
    if (await this.exhausted()) await this.notify(month, now);
    return response;
  }

  async assertAvailable(): Promise<void> {
    const now = this.clock.now();
    const month = now.toISOString().slice(0, 7);
    await this.database
      .insertInto("community_discussion_budget_months")
      .values({
        bot_identity: this.config.botIdentity,
        month,
        cost_micro_usd: "0",
        notified: false,
      })
      .onConflict((c) => c.columns(["bot_identity", "month"]).doNothing())
      .execute();
    if (await this.exhausted()) {
      await this.notify(month, now);
      throw new DiscussionBudgetExceeded();
    }
  }

  async exhausted(): Promise<boolean> {
    const snapshot = await this.snapshot();
    return (
      snapshot.monthCostMicroUsd >=
      (this.config.communityDiscussions?.budget.monthlyLimitMicroUsd ?? 0)
    );
  }

  async persistRun(
    run: DiscussionRun,
    transaction?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const values = {
      bot_identity: this.config.botIdentity,
      finished_at: this.clock.now(),
      status: run.status,
      messages: run.messages,
      transcriptions: run.transcriptions,
      discussions: run.discussions,
      errors: run.errors,
      skips: run.skips,
    };
    await (transaction ?? this.database)
      .insertInto("community_discussion_runs")
      .values(values)
      .onConflict((c) => c.column("bot_identity").doUpdateSet(values))
      .execute();
  }

  async snapshot() {
    const month = this.clock.now().toISOString().slice(0, 7);
    const [total, calls, lastRun] = await Promise.all([
      this.database
        .selectFrom("community_discussion_budget_months")
        .select("cost_micro_usd")
        .where("bot_identity", "=", this.config.botIdentity)
        .where("month", "=", month)
        .executeTakeFirst(),
      this.database
        .selectFrom("community_discussion_model_calls")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("bot_identity", "=", this.config.botIdentity)
        .where("month", "=", month)
        .executeTakeFirstOrThrow(),
      this.database
        .selectFrom("community_discussion_runs")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .executeTakeFirst(),
    ]);
    return {
      month,
      monthCostMicroUsd: Number(total?.cost_micro_usd ?? 0),
      modelCalls: Number(calls.count),
      lastRun: lastRun ?? null,
    };
  }

  async retryNotification(): Promise<void> {
    const now = this.clock.now();
    await this.notify(now.toISOString().slice(0, 7), now);
  }

  private async notify(month: string, now: Date): Promise<void> {
    try {
      const prior = await this.database
        .selectFrom("community_discussion_budget_months")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .where("month", "=", month)
        .executeTakeFirst();
      if (!prior || prior.notified) return;
      const candidate = await this.authors.budgetNoticeCandidate(
        this.config.botIdentity,
        prior.notification_after_user ?? undefined,
      );
      await this.database.transaction().execute(async (tx) => {
        const total = await tx
          .selectFrom("community_discussion_budget_months")
          .selectAll()
          .where("bot_identity", "=", this.config.botIdentity)
          .where("month", "=", month)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (total.notified) return;
        const notified =
          candidate.recipient !== null &&
          (await this.authors.enqueueBudgetNotice(
            tx,
            candidate.recipient,
            month,
            now,
          ));
        await tx
          .updateTable("community_discussion_budget_months")
          .set({ notified, notification_after_user: candidate.nextAfter })
          .where("bot_identity", "=", this.config.botIdentity)
          .where("month", "=", month)
          .execute();
      });
    } catch (error) {
      reportFailure("community-discussions.budget-notification", error);
    }
  }
}

/** The existing model port remains injectable; both paid operations pass through one gate. */
export class BudgetedDiscussionModel implements CommunityDiscussionModel {
  constructor(
    private readonly model: CommunityDiscussionModel,
    private readonly budget: CommunityDiscussionBudget,
  ) {}
  group(
    ...args: Parameters<CommunityDiscussionModel["group"]>
  ): ReturnType<CommunityDiscussionModel["group"]> {
    return this.budget.call("group", () => this.model.group(...args));
  }
  transcribe(
    ...args: Parameters<CommunityDiscussionModel["transcribe"]>
  ): ReturnType<CommunityDiscussionModel["transcribe"]> {
    return this.budget.call(
      "transcribe",
      () => this.model.transcribe(...args),
      args[0].durationSeconds,
    );
  }
}

function tokenCost(tokens: number | null, rate: number): number {
  if (tokens === null || !Number.isSafeInteger(tokens) || tokens < 0) return 0;
  return boundedCost((BigInt(tokens) * BigInt(rate) + 999_999n) / 1_000_000n);
}
function audioCost(seconds: number | null | undefined, rate: number): number {
  if (
    seconds === null ||
    seconds === undefined ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    return 0;
  const milliseconds = Math.ceil(seconds * 1000);
  if (!Number.isSafeInteger(milliseconds)) return Number.MAX_SAFE_INTEGER;
  return boundedCost((BigInt(milliseconds) * BigInt(rate) + 59_999n) / 60_000n);
}
function boundedCost(cost: bigint): number {
  return Number(
    cost > BigInt(Number.MAX_SAFE_INTEGER)
      ? BigInt(Number.MAX_SAFE_INTEGER)
      : cost,
  );
}
