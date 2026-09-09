import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { PlatformConfig } from '../../../config/platform-config.js';
import type { SendNotificationEmail } from '../ports/notification-sources.js';
const smtpTimeoutMs = 10_000;
export function assembleNotificationEmailSender(config: NonNullable<PlatformConfig['billingContact']>): SendNotificationEmail {
  const transport = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpPort === 465,
    requireTLS: !config.localInsecure, ignoreTLS: config.localInsecure, connectionTimeout: smtpTimeoutMs, greetingTimeout: smtpTimeoutMs, socketTimeout: smtpTimeoutMs,
    ...(config.smtpUser && config.smtpPassword ? { auth: { user: config.smtpUser, pass: config.smtpPassword } } : {}), disableFileAccess: true, disableUrlAccess: true });
  return async message => {
    try {
      const response: unknown = await transport.sendMail({ from: config.from, to: message.email, subject: message.subject, text: message.text,
        messageId: `<${message.operationId}@${config.from.split('@')[1]}>` });
      const parsed = z.object({ accepted: z.array(z.string()), rejected: z.array(z.string()) }).safeParse(response);
      return parsed.success && parsed.data.accepted.includes(message.email) ? { state: 'sent' } : { state: 'unknown' };
    } catch (error) {
      const rejected = z.object({ responseCode: z.number().int(), command: z.string() }).safeParse(error);
      // Only explicit negative SMTP replies prove non-delivery. Timeout/ambiguous failures stay unknown.
      if (rejected.success && rejected.data.responseCode >= 400 && rejected.data.responseCode < 500) return { state: 'not_sent', retryAfterMs: 5_000 };
      if (rejected.success && rejected.data.responseCode >= 500 && rejected.data.responseCode < 600) return { state: 'failed', reason: 'provider_rejected' };
      return { state: 'unknown' };
    }
  };
}
