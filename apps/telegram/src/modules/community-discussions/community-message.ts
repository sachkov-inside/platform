/** A human message accepted from the configured Community Group. */
export interface CommunityMessageInput {
  readonly botIdentity: string;
  readonly updateId: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly threadId: string | null;
  readonly replyToMessageId: string | null;
  readonly sentAt: Date;
  readonly editedAt: Date | null;
  readonly senderTelegramUserId: string;
  readonly kind: "text" | "photo" | "document" | "voice" | "video_note";
  readonly text: string;
  readonly fileId: string | null;
  readonly durationSeconds?: number | null;
}

export type CommunityMessage = Omit<CommunityMessageInput, "updateId"> & {
  /** Null defers discussion processing until Platform confirms the sender role. */
  readonly isAuthor: boolean | null;
};
