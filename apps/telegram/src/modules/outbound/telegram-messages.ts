export type TelegramButton = { readonly text: string } & (
  | { readonly callbackData: string; readonly url?: never }
  | { readonly url: string; readonly callbackData?: never }
);
export interface TelegramTextMessage {
  readonly chatId: string;
  readonly text: string;
  readonly buttons?: readonly TelegramButton[];
}

export type TelegramDeliveryResult =
  | { readonly kind: "api_rejected"; readonly providerErrorCode: number }
  | {
      readonly kind: "api_retryable";
      readonly providerErrorCode: number;
      readonly retryAfterSeconds?: number;
    }
  | { readonly kind: "delivered"; readonly providerMessageId: string }
  | { readonly kind: "transport_unknown" };

export interface TelegramMessageEdit {
  readonly chatId: string;
  readonly messageId: string;
  readonly text: string;
  /** Replaces the earlier keyboard; absent removes all controls. */
  readonly buttons?: readonly TelegramButton[];
}

/** A message that carries an HTML widget (Bot API 10.4) to a private chat. */
export interface TelegramWidgetMessage {
  readonly chatId: string;
  /** The widget's code; Telegram fixes it in the message when it is sent. */
  readonly html: string;
  /** The state the widget starts from. */
  readonly chatData: string;
  /** Shown under the widget, and instead of it by an app that cannot show widgets. */
  readonly caption?: string;
  /** Logical pixels; zero lets Telegram follow the compact content height. */
  readonly height: number;
}

export interface TelegramWidgetAnswer {
  readonly queryId: string;
  readonly data: string;
}

export interface TelegramMessages {
  editText(message: TelegramMessageEdit): Promise<TelegramDeliveryResult>;
  sendText(message: TelegramTextMessage): Promise<TelegramDeliveryResult>;
  sendWidget(message: TelegramWidgetMessage): Promise<TelegramDeliveryResult>;
  /**
   * Answers a press inside a widget. Telegram takes the answer only for a few seconds, so it
   * is never queued or retried: a failed answer is reported and the widget shows its own
   * no-answer state.
   */
  answerWidgetQuery(answer: TelegramWidgetAnswer): Promise<void>;
}

/** The text operations alone, for senders that never deal with widgets. */
export type TelegramTextMessages = Pick<
  TelegramMessages,
  "editText" | "sendText"
>;

export const TELEGRAM_MESSAGES = Symbol("TELEGRAM_MESSAGES");
