import type {
  CommunicationMessage,
  CommunicationTransport,
} from "./communication-delivery.js";
import type { TelegramDeliveryResult } from "../outbound/telegram-messages.js";
import type { NativeMessages } from "./native-messages.js";
import type { NativeMessageCopy } from "./native-message-copy.js";

/** Legacy snapshots keep their transport; native snapshots always copy the private preserved source. */
export class NativeCommunicationTransport implements CommunicationTransport {
  constructor(
    private readonly legacy: CommunicationTransport,
    private readonly native: NativeMessages,
    private readonly copy: NativeMessageCopy,
  ) {}
  async send(message: CommunicationMessage): Promise<TelegramDeliveryResult> {
    if (message.content.type !== "native") return this.legacy.send(message);
    const command = await this.native.resolve(message.content, message.chatId);
    if (!command) return { kind: "api_rejected", providerErrorCode: 400 };
    const result = await this.copy.copy(command);
    if (result.kind === "partial") return { kind: "transport_unknown" };
    if (result.kind !== "delivered") return result;
    const id = result.messageIds[0];
    return id === undefined
      ? { kind: "transport_unknown" }
      : { kind: "delivered", providerMessageId: String(id) };
  }
}
