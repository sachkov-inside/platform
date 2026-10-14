import { z } from "zod";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { billingContactProtection } from "../../infrastructure/billing-contact-protection.js";
import { hasText } from "../../../../infrastructure/contracts/text.js";

/** Account enumeration and current verified contact, shared by the Notifications composition. */
export class NotificationAccounts {
  constructor(
    private readonly prisma: AccountsPrismaClient,
    private readonly protection:
      ReturnType<typeof billingContactProtection> | undefined,
  ) {}
  async enumerate(query: {
    occurredAt: Date;
    after: string | null;
    limit: number;
  }) {
    const limit = z.number().int().min(1).max(100).parse(query.limit);
    const rows = await this.prisma.account.findMany({
      where: {
        createdAt: { lte: query.occurredAt },
        ...(hasText(query.after)
          ? { id: { gt: z.uuid().parse(query.after) } }
          : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
  async exists(accountId: string) {
    return (
      (await this.prisma.account.findUnique({
        where: { id: z.uuid().parse(accountId) },
        select: { id: true },
      })) !== null
    );
  }
  async binding(accountId: string) {
    const row = await this.prisma.billingContact.findUnique({
      where: { accountId: z.uuid().parse(accountId) },
    });
    // The verified contact row is keyed by Account, and revision changes after each confirmation.
    return row?.verifiedAt && hasText(row.emailCiphertext)
      ? {
          channel: "email" as const,
          accountRef: accountId,
          contactRef: accountId,
          contactRevision: row.revision,
        }
      : null;
  }
  /** Current verified bindings, including null for each missing or unverified Account contact. */
  async bindings(accountIds: readonly string[]) {
    const requested = z.array(z.uuid()).parse(accountIds);
    const ids = [...new Set(requested.map((id) => id.toLowerCase()))];
    const result = new Map<
      string,
      Awaited<ReturnType<NotificationAccounts["binding"]>>
    >();
    for (const id of ids) result.set(id, null);
    for (let offset = 0; offset < ids.length; offset += 500) {
      const rows = await this.prisma.billingContact.findMany({
        where: { accountId: { in: ids.slice(offset, offset + 500) } },
        select: {
          accountId: true,
          revision: true,
          verifiedAt: true,
          emailCiphertext: true,
        },
      });
      for (const row of rows)
        if (row.verifiedAt && hasText(row.emailCiphertext))
          result.set(row.accountId, {
            channel: "email",
            accountRef: row.accountId,
            contactRef: row.accountId,
            contactRevision: row.revision,
          });
    }
    // Result keys and Account contact references keep the caller's accepted UUID spelling.
    return new Map(
      requested.map((id) => {
        const binding = result.get(id.toLowerCase()) ?? null;
        return [
          id,
          binding === null
            ? null
            : { ...binding, accountRef: id, contactRef: id },
        ];
      }),
    );
  }
  async email(binding: {
    accountRef: string;
    contactRef: string;
    contactRevision: number;
  }) {
    if (
      binding.accountRef !== binding.contactRef ||
      !z.uuid().safeParse(binding.accountRef).success
    )
      return null;
    const row = await this.prisma.billingContact.findUnique({
      where: { accountId: binding.accountRef },
    });
    if (
      !row?.verifiedAt ||
      !hasText(row.emailCiphertext) ||
      row.revision !== binding.contactRevision
    )
      return null;
    if (!this.protection) throw new Error("notification_contact_unavailable");
    return this.protection.open(binding.accountRef, row.emailCiphertext);
  }
}
