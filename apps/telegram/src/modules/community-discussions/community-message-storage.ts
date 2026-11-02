import type { ColumnType } from "kysely";
import type { CommunityMessageInput } from "./community-message.js";

type Timestamp = ColumnType<Date, Date, Date>;

export interface CommunityMessageTables {
  community_messages: {
    bot_identity: string;
    chat_id: string;
    message_id: string;
    thread_id: string | null;
    reply_to_message_id: string | null;
    sent_at: Timestamp;
    edited_at: Timestamp | null;
    sender_telegram_user_id: string;
    is_author: boolean | null;
    kind: CommunityMessageInput["kind"];
    text: string;
    file_id: string | null;
    last_update_id: string;
  };
}
