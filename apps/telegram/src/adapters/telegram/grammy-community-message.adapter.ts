import { z } from "zod";
import type { CommunityMessageInput } from "../../modules/community-discussions/community-message.js";

const messageId = z.int().positive();
const messageSchema = z.object({
  message_id: messageId,
  date: z.int().nonnegative().max(8_000_000_000_000),
  edit_date: z.int().nonnegative().max(8_000_000_000_000).optional(),
  chat: z.object({
    id: z.int().negative(),
    type: z.enum(["group", "supergroup"]),
  }),
  from: z.object({ id: messageId, is_bot: z.literal(false) }),
  message_thread_id: messageId.optional(),
  reply_to_message: z.object({ message_id: messageId }).optional(),
  text: z.string().min(1).max(4096).optional(),
  caption: z.string().max(1024).optional(),
  photo: z
    .array(z.object({ file_id: z.string().min(1) }))
    .min(1)
    .optional(),
  document: z.object({ file_id: z.string().min(1) }).optional(),
});

export function translateCommunityMessage(
  botIdentity: string,
  updateId: string,
  payload: unknown,
): CommunityMessageInput | undefined {
  const update = z
    .object({
      message: z.unknown().optional(),
      edited_message: z.unknown().optional(),
    })
    .safeParse(payload);
  if (!update.success) return;
  const parsed = messageSchema.safeParse(
    update.data.message ?? update.data.edited_message,
  );
  if (!parsed.success) return;
  const message = parsed.data;
  const kind =
    message.text !== undefined
      ? "text"
      : message.photo !== undefined
        ? "photo"
        : message.document !== undefined
          ? "document"
          : undefined;
  const text = message.text ?? message.caption ?? "";
  if (kind === undefined) return;
  return {
    botIdentity,
    updateId,
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    threadId:
      message.message_thread_id === undefined
        ? null
        : String(message.message_thread_id),
    replyToMessageId:
      message.reply_to_message === undefined
        ? null
        : String(message.reply_to_message.message_id),
    sentAt: new Date(message.date * 1000),
    editedAt:
      message.edit_date === undefined
        ? null
        : new Date(message.edit_date * 1000),
    senderTelegramUserId: String(message.from.id),
    kind,
    text,
    fileId: null,
  };
}
