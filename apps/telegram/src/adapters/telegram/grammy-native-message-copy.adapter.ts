import { telegramCommunicationFailure } from "./telegram-communication-failure.js";
import { type Api } from "grammy";
import type {
  NativeCopyCommand,
  NativeCopyResult,
  NativeMessageCopy,
} from "../../modules/communications/native-message-copy.js";
import { validateContent } from "../../modules/communications/communications-contract.js";
import { buttonRows } from "../../modules/communications/button-rows.js";
export class GrammyNativeMessageCopy implements NativeMessageCopy {
  constructor(
    private readonly api: Pick<Api, "copyMessage" | "copyMessages">,
  ) {}
  async copy(command: NativeCopyCommand): Promise<NativeCopyResult> {
    const ids = command.messageIds;
    if (
      !/^[1-9][0-9]*$/u.test(command.chatId) ||
      !/^[1-9][0-9]*$/u.test(command.sourceChatId) ||
      ids.length === 0 ||
      ids.length > 100 ||
      ids.some(
        (id, index) =>
          !Number.isSafeInteger(id) ||
          id <= 0 ||
          (index > 0 && id <= (ids[index - 1] ?? 0)),
      ) ||
      (ids.length > 1 && command.buttons.length > 0)
    )
      return { kind: "api_rejected", providerErrorCode: 400 };
    try {
      validateContent({
        type: "text",
        text: "Native message",
        entities: [],
        buttons: command.buttons,
      });
    } catch {
      return { kind: "api_rejected", providerErrorCode: 400 };
    }
    try {
      const first = ids[0];
      if (first === undefined)
        return { kind: "api_rejected", providerErrorCode: 400 };
      const sent =
        ids.length === 1
          ? [
              await this.api.copyMessage(
                command.chatId,
                command.sourceChatId,
                first,
                {
                  reply_markup: {
                    inline_keyboard: buttonRows(command.buttons),
                  },
                },
              ),
            ]
          : await this.api.copyMessages(command.chatId, command.sourceChatId, [
              ...ids,
            ]);
      const messageIds = sent.map((message) => message.message_id);
      if (
        messageIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(messageIds).size !== messageIds.length
      )
        return { kind: "transport_unknown" };
      return {
        kind: messageIds.length === ids.length ? "delivered" : "partial",
        messageIds,
      };
    } catch (error) {
      return telegramCommunicationFailure(error);
    }
  }
}
