import { vi } from "vitest";
import { z } from "zod";
import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";

/** Unit-only database boundary; PostgreSQL acceptance owns actual filtering and constraints. */
export function diagnosticDatabase(
  input: {
    payments?: unknown[];
    grants?: unknown[];
    rightsFailure?: boolean;
    permissionGranted?: boolean;
    accountExists?: boolean;
    refunds?: unknown[];
  } = {},
) {
  const source = z.object({ source: z.string() });
  const database = {
    account: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          input.accountExists === false
            ? null
            : { id: "10000000-0000-4000-8000-000000000001" },
        ),
    },
    accountPermission: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          input.permissionGranted === false
            ? null
            : { accountId: "10000000-0000-4000-8000-000000000001" },
        ),
    },
    accessGrant: {
      findMany:
        input.rightsFailure === true
          ? vi.fn().mockRejectedValue(new Error("source offline"))
          : vi
              .fn()
              .mockResolvedValue(
                (input.grants ?? []).filter(
                  (row) => source.parse(row).source === "paid",
                ),
              ),
    },
    billingPurchase: {
      findMany: vi.fn().mockResolvedValue(input.payments ?? []),
    },
    billingRefund: { groupBy: vi.fn().mockResolvedValue(input.refunds ?? []) },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This substitutes only the external Prisma reads exercised by the unit cases; integration uses PostgreSQL.
  return database as unknown as PlatformPrisma;
}
