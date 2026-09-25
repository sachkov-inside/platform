import nodemailer from "nodemailer";

import type { PlatformConfig } from "../../config/platform-config.js";

const smtpTimeoutMs = 10_000;

export interface SmtpMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** Stable identity of the message; a retried send keeps the same Message-ID. */
  readonly messageRef: string;
}

/**
 * The one SMTP transport of the backend: TLS unless the local stand opts out, bounded timeouts,
 * no file or URL access, and a Message-ID in the sender's domain. The result is the provider's
 * raw reply for the caller to interpret; a failure rejects with the transport error.
 */
export function assembleSmtpTransport(
  config: NonNullable<PlatformConfig["billingContact"]>,
): (message: SmtpMessage) => Promise<unknown> {
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
  const domain = config.from.split("@")[1];
  return ({ messageRef, subject, text, to }) =>
    transport.sendMail({ from: config.from, to, subject, text, messageId: `<${messageRef}@${domain}>` });
}
