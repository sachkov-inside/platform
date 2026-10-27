import { z } from "zod";

import {
  dayValueRowsSchema,
  type DailyWindow,
  type DayValue,
} from "../../../../infrastructure/contracts/daily-window.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type AccountsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { isDirectoryPerson } from "../../shared/directory-person.js";

export type NewPeopleResult =
  | { readonly ok: true; readonly days: readonly DayValue[] }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

const inputSchema = z.strictObject({
  from: z.date(),
  to: z.date(),
  timeZone: z.string().min(1),
  linkedAccountIds: z.array(z.uuid().toLowerCase()),
});

/**
 * People registered in each calendar day of the window, by the directory's person rule, so the
 * Overview's new people match «Люди». Days without a registration are absent. The caller bounds
 * `linkedAccountIds` (Telegram Membership refuses more than 50 000).
 */
export async function countNewPeople(
  prisma: AccountsPrismaClient,
  input: DailyWindow & { readonly linkedAccountIds: readonly string[] },
  limit: number,
): Promise<NewPeopleResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || parsed.data.linkedAccountIds.length > limit)
    return { ok: false, error: { code: "invalid_request" } };
  const { from, to, timeZone, linkedAccountIds } = parsed.data;
  try {
    const rows: unknown = await prisma.$queryRaw(Prisma.sql`
      select to_char((account.created_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as date,
        count(*)::int as value
      from accounts.accounts account
      where account.created_at >= ${from} and account.created_at < ${to}
        and ${isDirectoryPerson(linkedAccountIds)}
      group by 1 order by 1
    `);
    return { ok: true, days: dayValueRowsSchema.parse(rows) };
  } catch (error) {
    return dependencyFailure(
      { module: "accounts", operation: "countNewPeople" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } } as const,
    );
  }
}
