import type { ColumnType } from "kysely";
import type {
  DiscussionStatus,
  CommunityDiscussionsSuccess,
} from "@inside/contracts/community-discussions";
type Timestamp = ColumnType<Date, Date, Date>;
export interface DiscussionTables {
  community_discussion_budget_months: {
    bot_identity: string;
    month: string;
    cost_micro_usd: ColumnType<string, string, string>;
    notified: boolean;
    notification_after_user: ColumnType<
      string | null,
      string | null | undefined,
      string | null
    >;
  };
  community_discussion_model_calls: {
    id: string;
    bot_identity: string;
    month: string;
    operation: "group" | "transcribe";
    cost_micro_usd: ColumnType<string, string, string>;
    state: "reserved" | "completed" | "failed";
    created_at: Timestamp;
  };
  community_discussion_runs: {
    bot_identity: string;
    finished_at: Timestamp;
    status: string;
    messages: number;
    transcriptions: number;
    discussions: number;
    errors: number;
    skips: number;
  };
  community_discussions: {
    id: string;
    bot_identity: string;
    chat_id: string;
    status: DiscussionStatus;
    question: string;
    answers: string;
    conclusion: string;
    material_urls: ColumnType<string[], string, string>;
    created_at: Timestamp;
    updated_at: Timestamp;
  };
  community_discussion_sources: {
    discussion_id: string;
    bot_identity: string;
    chat_id: string;
    message_id: string;
    thread_id: string | null;
    reply_to_message_id: string | null;
    sent_at: Timestamp;
    role: string;
    kind: string;
    source_url: string;
  };
  community_discussion_schedule: {
    budget_blocked_limit: ColumnType<
      string | null,
      string | null | undefined,
      string | null
    >;
    budget_blocked_month: ColumnType<
      string | null,
      string | null | undefined,
      string | null
    >;
    bot_identity: string;
    next_run_at: Timestamp;
    lease_token: string | null;
    lease_until: ColumnType<Date | null, Date | null, Date | null>;
  };
  community_discussion_mark_receipts: {
    bot_identity: string;
    account_ref: string;
    request_id: string;
    fingerprint: string;
    response: ColumnType<CommunityDiscussionsSuccess, string, string>;
  };
}
