import type { TelegramDeliveryResult } from "../modules/outbound/telegram-messages.js";

export const TELEGRAM_OBSERVABILITY = Symbol("TELEGRAM_OBSERVABILITY");

export interface WaitlistHttpObservation {
  traceparent(): string | undefined;
  response(status: number): void;
  complete(outcome: "accepted" | "suppressed" | "unavailable"): void;
}

/** Telegram-owned technical port. No arbitrary labels, credentials, URLs or business payloads. */
export interface TelegramObservability {
  runReceipt<Value>(
    parent: string | undefined,
    work: (firstCarrier: string | null) => Promise<Value>,
  ): Promise<Value>;
  runAuthorization<Value>(
    parent: string | null,
    work: (wire: WaitlistHttpObservation) => Promise<Value>,
  ): Promise<Value>;
  runAttempt<Value>(
    parent: string | null,
    work: () => Promise<Value>,
  ): Promise<Value>;
  runBotApi<Value extends TelegramDeliveryResult>(
    work: () => Promise<Value>,
  ): Promise<Value>;
  shutdown(): Promise<void>;
}

const disabledHttp: WaitlistHttpObservation = {
  traceparent: () => undefined,
  response: () => undefined,
  complete: () => undefined,
};

export const disabledTelegramObservability: TelegramObservability = {
  runReceipt: (_parent, work) => work(null),
  runAuthorization: (_parent, work) => work(disabledHttp),
  runAttempt: (_parent, work) => work(),
  runBotApi: (work) => work(),
  shutdown: () => Promise.resolve(),
};
