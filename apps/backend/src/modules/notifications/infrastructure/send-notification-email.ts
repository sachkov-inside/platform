import { z } from 'zod';
import { dependencyFailure } from '../../../infrastructure/observability/index.js';
import { assembleSmtpTransport } from '../../../infrastructure/smtp/smtp-transport.js';
import type { PlatformConfig } from '../../../config/platform-config.js';
import type { SendNotificationEmail } from '../ports/notification-sources.js';
export function assembleNotificationEmailSender(config: NonNullable<PlatformConfig['billingContact']>): SendNotificationEmail {
  const send = assembleSmtpTransport(config);
  return async message => {
    try {
      const response = await send({ to: message.email, subject: message.subject, text: message.text, messageRef: message.operationId });
      const parsed = z.object({ accepted: z.array(z.string()), rejected: z.array(z.string()) }).safeParse(response);
      return parsed.success && parsed.data.accepted.includes(message.email) ? { state: 'sent' } : { state: 'unknown' };
    } catch (error) {
      const rejected = z.object({ responseCode: z.number().int(), command: z.string() }).safeParse(error);
      // Only explicit negative SMTP replies prove non-delivery. Timeout/ambiguous failures stay unknown.
      if (rejected.success && rejected.data.responseCode >= 400 && rejected.data.responseCode < 500) return { state: 'not_sent', retryAfterMs: 5_000 };
      if (rejected.success && rejected.data.responseCode >= 500 && rejected.data.responseCode < 600) return { state: 'failed', reason: 'provider_rejected' };
      return dependencyFailure({ module: 'notifications', operation: 'sendEmail' }, error, { state: 'unknown' });
    }
  };
}
