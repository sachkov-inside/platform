import { createHash } from "node:crypto";
import { isTruthy } from "../../shared/truthiness.js";
import { hasText } from "../../shared/text.js";
import type { ActivationConfig } from "../../config/activation-config.js";
import type {
  TelegramButton,
  TelegramDeliveryResult,
  TelegramTextMessage,
} from "../outbound/telegram-messages.js";

export const ACTIVATION_ANNOUNCEMENT_BUTTON = "Получить доступ";
const ACTIVATION_CODE = /^[A-Za-z0-9_-]{1,40}$/;
const BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
export interface ActivationAnnouncementTelegram {
  botUsername(): Promise<string | undefined>;
  privateChat(chatId: string): Promise<boolean>;
  sendText(message: TelegramTextMessage): Promise<TelegramDeliveryResult>;
}
export interface ActivationAnnouncementPlatform {
  resolve(
    code: string,
  ): Promise<
    { readonly sourceRef: string; readonly productId: string } | undefined
  >;
}
/** A claim survives crashes and unknown provider outcomes; no automatic retry is safe. */
export interface AnnouncementDeliveries {
  claim(operationId: string, fingerprint: string): Promise<boolean>;
  complete(
    operationId: string,
    status: "sent" | "not_sent" | "unknown",
  ): Promise<void>;
}
export interface ActivationAnnouncementInput {
  readonly activation: ActivationConfig | undefined;
  readonly sourceRef: string;
  readonly productId: string;
  readonly code: string;
  readonly text: string;
  readonly privateChatId: string;
  readonly operationId: string;
  readonly send: boolean;
}
export type ActivationAnnouncementResult =
  | {
      readonly status: "ready" | "sent";
      readonly text: string;
      readonly button: TelegramButton;
    }
  | {
      readonly status: "refused";
      readonly reason:
        | "activation_disabled"
        | "invalid_code"
        | "unknown_source"
        | "not_whole_group"
        | "invalid_text"
        | "invalid_operation"
        | "not_private"
        | "rule_mismatch"
        | "no_bot_username"
        | "already_attempted";
    }
  | { readonly status: "not_sent"; readonly providerErrorCode: number }
  | { readonly status: "unknown" };

/** Generate an owner sample; only the owner forwards it to the registered source group. */
export async function announceActivation(
  input: ActivationAnnouncementInput,
  telegram: ActivationAnnouncementTelegram,
  platform: ActivationAnnouncementPlatform,
  deliveries: AnnouncementDeliveries,
): Promise<ActivationAnnouncementResult> {
  if (!isTruthy(input.activation?.enabled))
    return { status: "refused", reason: "activation_disabled" };
  if (!ACTIVATION_CODE.test(input.code))
    return { status: "refused", reason: "invalid_code" };
  const source = input.activation.sources.find(
    (candidate) => candidate.sourceRef === input.sourceRef,
  );
  if (!source) return { status: "refused", reason: "unknown_source" };
  if (source.policy !== "whole_group")
    return { status: "refused", reason: "not_whole_group" };
  if (!hasText(input.text.trim()) || input.text.length > 4096)
    return { status: "refused", reason: "invalid_text" };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId))
    return { status: "refused", reason: "invalid_operation" };
  if (
    !/^[1-9][0-9]{0,15}$/.test(input.privateChatId) ||
    !Number.isSafeInteger(Number(input.privateChatId)) ||
    !(await telegram.privateChat(input.privateChatId))
  )
    return { status: "refused", reason: "not_private" };
  const rule = await platform.resolve(input.code);
  if (
    !rule ||
    rule.sourceRef !== input.sourceRef ||
    rule.productId !== input.productId
  )
    return { status: "refused", reason: "rule_mismatch" };
  const username = await telegram.botUsername();
  if (!hasText(username) || !BOT_USERNAME.test(username))
    return { status: "refused", reason: "no_bot_username" };
  const button: TelegramButton = {
    text: ACTIVATION_ANNOUNCEMENT_BUTTON,
    url: `https://t.me/${username}?start=a_${input.code}`,
  };
  const announcement = { text: input.text, button };
  if (!input.send) return { status: "ready", ...announcement };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        input.privateChatId,
        input.sourceRef,
        input.productId,
        input.code,
        input.text,
        button.url,
      ]),
    )
    .digest("hex");
  if (!(await deliveries.claim(input.operationId, fingerprint)))
    return { status: "refused", reason: "already_attempted" };
  const delivery = await telegram.sendText({
    chatId: input.privateChatId,
    text: input.text,
    buttons: [button],
  });
  await deliveries.complete(
    input.operationId,
    delivery.kind === "delivered"
      ? "sent"
      : delivery.kind === "transport_unknown"
        ? "unknown"
        : "not_sent",
  );
  if (delivery.kind === "delivered") return { status: "sent", ...announcement };
  if (delivery.kind === "transport_unknown") return { status: "unknown" };
  return { status: "not_sent", providerErrorCode: delivery.providerErrorCode };
}
