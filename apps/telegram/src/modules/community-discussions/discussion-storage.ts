import type { ColumnType } from "kysely";
import type {
  DiscussionStatus,
  CommunityDiscussionsSuccess,
} from "@inside/contracts/community-discussions";
type Timestamp = ColumnType<Date, Date, Date>;
export interface DiscussionTables {
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
