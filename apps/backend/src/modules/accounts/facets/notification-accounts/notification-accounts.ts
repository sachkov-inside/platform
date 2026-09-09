import { z } from 'zod';
import type { AccountsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import type { billingContactProtection } from '../../infrastructure/billing-contact-protection.js';

/** Account enumeration and current verified contact, shared by the Notifications composition. */
export class NotificationAccounts {
  constructor(private readonly prisma: AccountsPrismaClient, private readonly protection: ReturnType<typeof billingContactProtection> | undefined) {}
  async enumerate(query: { occurredAt: Date; after: string | null; limit: number }) {
    const limit = z.number().int().min(1).max(100).parse(query.limit);
    const rows = await this.prisma.account.findMany({ where: { createdAt: { lte: query.occurredAt }, ...(query.after ? { id: { gt: z.uuid().parse(query.after) } } : {}) }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    return rows.map(row => row.id);
  }
  async exists(accountId: string) {
    return (await this.prisma.account.findUnique({ where: { id: z.uuid().parse(accountId) }, select: { id: true } })) !== null;
  }
  async binding(accountId: string) {
    const row = await this.prisma.billingContact.findUnique({ where: { accountId: z.uuid().parse(accountId) } });
    // The verified contact row is keyed by Account, and revision changes after each confirmation.
    return row?.verifiedAt && row.emailCiphertext ? { channel: 'email' as const, accountRef: accountId, contactRef: accountId, contactRevision: row.revision } : null;
  }
  async email(binding: { accountRef: string; contactRef: string; contactRevision: number }) {
    if (binding.accountRef !== binding.contactRef || !z.uuid().safeParse(binding.accountRef).success) return null;
    const row = await this.prisma.billingContact.findUnique({ where: { accountId: binding.accountRef } });
    if (!row?.verifiedAt || !row.emailCiphertext || row.revision !== binding.contactRevision) return null;
    if (!this.protection) throw new Error('notification_contact_unavailable');
    return this.protection.open(binding.accountRef, row.emailCiphertext);
  }
}
