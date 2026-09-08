import { z } from 'zod';
import { createPrismaClient } from '../../../src/infrastructure/prisma/index.js';
import { NotificationAccounts } from '../../../src/modules/accounts/index.js';
import { billingContactProtection } from '../../../src/modules/accounts/infrastructure/billing-contact-protection.js';
import { dispatchEmail } from '../../../src/modules/notifications/features/dispatch-email/dispatch-email.js';
import { eventSchema, contentSchema } from '../../../src/modules/notifications/domain/notification-wire.js';
const config = z.object({ databaseUrl: z.string(), actor: z.uuid(), now: z.string(), event: eventSchema,
  fact: z.object({ status: z.literal('current'), event: eventSchema, content: contentSchema, accountId: z.string().nullable(), title: z.string(), readerPath: z.string(), amountMinor: z.number().optional() }) }).parse(JSON.parse(process.env.NOTIFICATION_CRASH_FIXTURE ?? 'null'));
const { amountMinor, ...fact } = config.fact;
const source = { ...fact, ...(amountMinor === undefined ? {} : { amountMinor }) };
const prisma = createPrismaClient(config.databaseUrl);
const contacts = new NotificationAccounts(prisma, billingContactProtection(Buffer.alloc(32, 43).toString('base64')));
await dispatchEmail({ prisma, origin: 'https://inside.example.test', now: () => new Date(config.now),
  sources: { resolve: event => Promise.resolve(event.occurrenceRef === config.event.occurrenceRef ? source : { status: 'unavailable' }), canRead: () => Promise.resolve('allowed') },
  recipients: { exists: id => contacts.exists(id), enumerate: query => contacts.enumerate(query), binding: (id, channel) => channel === 'email' ? contacts.binding(id) : Promise.resolve(null), email: binding => contacts.email(binding) },
}, async () => { process.send?.('started'); await new Promise(() => undefined); return { state: 'unknown' }; }, 'subscription');
