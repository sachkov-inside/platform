import { z } from "zod";
import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { AccountRightsPrisma } from "./prisma.js";
const receiptSchema = z.object({
  accountId: z.uuid(),
  decision: z.string().nullable(),
});
/** Latest decisive receipt for each Account, without materializing its receipt history. */
export async function currentMembershipReceipts(
  prisma: AccountRightsPrisma,
  accountIds: readonly string[],
) {
  if (accountIds.length === 0)
    return new Map<string, { decision: string | null }>();
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    select distinct on (account_id) account_id::text as "accountId", decision
    from account_rights.evidence_receipts
    where account_id in (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})
      and outcome='accepted_without_entitlement'
    order by account_id, received_at desc, delivery_id desc
  `);
  return new Map(
    z
      .array(receiptSchema)
      .parse(rows)
      .map((row) => [row.accountId, { decision: row.decision }]),
  );
}
