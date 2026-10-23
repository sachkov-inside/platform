import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { AccountProfilePersistenceClient } from "../../infrastructure/prisma.js";

/** Current active names for authorized author support. No private profile content is exposed. */
export class AccountNames {
  constructor(private readonly prisma: AccountProfilePersistenceClient) {}

  async read(accountIds: readonly string[]) {
    if (!z.array(z.uuid()).max(100).safeParse(accountIds).success)
      return { ok: false } as const;
    try {
      const rows = await this.prisma.memberProfile.findMany({
        where: { accountId: { in: [...accountIds] }, status: "active" },
        select: { accountId: true, displayName: true },
      });
      return {
        ok: true,
        names: new Map(rows.map((row) => [row.accountId, row.displayName])),
      } as const;
    } catch (error) {
      return dependencyFailure(
        { module: "account-profiles", operation: "readAccountNames" },
        error,
        { ok: false } as const,
      );
    }
  }
}
