import type { PlatformConfig } from "../../../config/platform-config.js";
import { assembleSmtpTransport } from "../../../infrastructure/smtp/smtp-transport.js";

export function assembleBillingContactSender(
  config: NonNullable<PlatformConfig["billingContact"]>,
) {
  const send = assembleSmtpTransport(config);
  return async ({
    email,
    code,
    challengeRef,
  }: {
    readonly email: string;
    readonly code: string;
    readonly challengeRef: string;
  }): Promise<void> => {
    await send({
      to: email,
      subject: "Код подтверждения email — Inside",
      messageRef: challengeRef,
      text: `Ваш код подтверждения email для чеков и уведомлений Inside: ${code}. Код действует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.`,
    });
  };
}
