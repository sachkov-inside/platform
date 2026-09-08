import nodemailer from "nodemailer";
import type { PlatformConfig } from "../../../config/platform-config.js";

const smtpTimeoutMs = 10_000;
export function assembleBillingContactSender(
  config: NonNullable<PlatformConfig["billingContact"]>,
) {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: !config.localInsecure,
    ignoreTLS: config.localInsecure,
    connectionTimeout: smtpTimeoutMs,
    greetingTimeout: smtpTimeoutMs,
    socketTimeout: smtpTimeoutMs,
    ...(config.smtpUser && config.smtpPassword
      ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
      : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return async ({
    email,
    code,
    challengeRef,
  }: {
    readonly email: string;
    readonly code: string;
    readonly challengeRef: string;
  }): Promise<void> => {
    await transport.sendMail({
      from: config.from,
      to: email,
      subject: "Код подтверждения email — Inside",
      messageId: `<${challengeRef}@${config.from.split("@")[1]}>`,
      text: `Ваш код подтверждения email для чеков и уведомлений Inside: ${code}. Код действует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.`,
    });
  };
}
