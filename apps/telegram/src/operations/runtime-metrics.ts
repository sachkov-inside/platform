import { Injectable } from "@nestjs/common";

import type { CommunitySnapshot } from "../modules/community/community-provider.js";

import {
  RUNTIME_COUNTER_NAMES,
  type RuntimeCounter,
  type RuntimeCounters,
} from "../shared/runtime-counters.js";

type Gauge =
  | "community_discussions_last_run_messages"
  | "community_discussions_last_run_transcriptions"
  | "community_discussions_last_run_discussions"
  | "community_discussions_last_run_errors"
  | "community_discussions_last_run_skips"
  | "community_discussions_last_run_timestamp_seconds"
  | "community_discussions_month_cost_micro_usd"
  | "community_discussions_month_model_calls"
  | "waitlist_confirmation_pending"
  | "waitlist_confirmation_unknown"
  | "waitlist_confirmation_rejected"
  | "activation_pending"
  | "activation_oldest_pending_seconds"
  | "community_due"
  | "community_effect_backlog"
  | "community_effect_waiting_for_join"
  | "community_effects_unknown"
  | "community_admission_restricted"
  | "community_oldest_due_seconds"
  | "evidence_delivery_backlog"
  | "reconciliation_due"
  | "reconciliation_oldest_due_seconds";

const gaugeNames: readonly Gauge[] = [
  "community_discussions_last_run_messages",
  "community_discussions_last_run_transcriptions",
  "community_discussions_last_run_discussions",
  "community_discussions_last_run_errors",
  "community_discussions_last_run_skips",
  "community_discussions_last_run_timestamp_seconds",
  "community_discussions_month_cost_micro_usd",
  "community_discussions_month_model_calls",
  "waitlist_confirmation_pending",
  "waitlist_confirmation_unknown",
  "waitlist_confirmation_rejected",
  "activation_pending",
  "activation_oldest_pending_seconds",
  "reconciliation_due",
  "reconciliation_oldest_due_seconds",
  "evidence_delivery_backlog",
  "community_due",
  "community_oldest_due_seconds",
  "community_effect_backlog",
  "community_effect_waiting_for_join",
  "community_effects_unknown",
  "community_admission_restricted",
];

@Injectable()
export class RuntimeMetrics implements RuntimeCounters {
  private readonly counters = new Map<RuntimeCounter, number>();
  private readonly gauges = new Map<Gauge, number>();

  increment(counter: RuntimeCounter, amount = 1): void {
    this.counters.set(counter, (this.counters.get(counter) ?? 0) + amount);
  }

  /** Community apply/reconcile lag is what makes an overdue right visible to an operator. */
  recordCommunity(snapshot: CommunitySnapshot): void {
    this.gauges.set("community_due", snapshot.dueStates);
    this.gauges.set(
      "community_oldest_due_seconds",
      snapshot.oldestDueAgeMs / 1000,
    );
    this.gauges.set("community_effect_backlog", snapshot.effectBacklog);
    this.gauges.set(
      "community_effect_waiting_for_join",
      snapshot.waitingForJoinEffects,
    );
    this.gauges.set("community_effects_unknown", snapshot.unknownEffects);
    this.gauges.set("community_admission_restricted", snapshot.restricted);
  }

  recordActivation(snapshot: { pending: number; oldestSeconds: number }): void {
    this.gauges.set("activation_pending", snapshot.pending);
    this.gauges.set(
      "activation_oldest_pending_seconds",
      snapshot.oldestSeconds,
    );
  }

  recordWaitlistConfirmations(states: Readonly<Record<string, number>>): void {
    this.gauges.set(
      "waitlist_confirmation_pending",
      (states["pending"] ?? 0) + (states["sending"] ?? 0),
    );
    this.gauges.set("waitlist_confirmation_unknown", states["unknown"] ?? 0);
    this.gauges.set("waitlist_confirmation_rejected", states["rejected"] ?? 0);
  }

  recordCommunityDiscussions(snapshot: {
    monthCostMicroUsd: number;
    modelCalls: number;
    lastRun: {
      messages: number;
      transcriptions: number;
      discussions: number;
      errors: number;
      skips: number;
      finished_at: Date;
    } | null;
  }): void {
    const run = snapshot.lastRun;
    this.gauges.set(
      "community_discussions_last_run_messages",
      run?.messages ?? 0,
    );
    this.gauges.set(
      "community_discussions_last_run_transcriptions",
      run?.transcriptions ?? 0,
    );
    this.gauges.set(
      "community_discussions_last_run_discussions",
      run?.discussions ?? 0,
    );
    this.gauges.set("community_discussions_last_run_errors", run?.errors ?? 0);
    this.gauges.set("community_discussions_last_run_skips", run?.skips ?? 0);
    this.gauges.set(
      "community_discussions_last_run_timestamp_seconds",
      run ? run.finished_at.getTime() / 1000 : 0,
    );
    this.gauges.set(
      "community_discussions_month_cost_micro_usd",
      snapshot.monthCostMicroUsd,
    );
    this.gauges.set(
      "community_discussions_month_model_calls",
      snapshot.modelCalls,
    );
  }

  render(): string {
    const counters = RUNTIME_COUNTER_NAMES.map(
      (name) => `inside_telegram_${name}_total ${this.counters.get(name) ?? 0}`,
    ).join("\n");
    const gauges = gaugeNames
      .map((name) => `inside_telegram_${name} ${this.gauges.get(name) ?? 0}`)
      .join("\n");
    return `${counters}\n${gauges}\n`;
  }
}
