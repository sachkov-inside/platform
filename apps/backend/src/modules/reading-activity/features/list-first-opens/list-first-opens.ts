import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ReadingActivityPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const MAX_MATERIALS = 1_000;
const materialIdsSchema = z.array(z.uuid().toLowerCase()).max(MAX_MATERIALS);
const rowsSchema = z.array(
  z.object({ account_id: z.uuid(), first_opened_at: z.date() }),
);

export type FirstOpensResult =
  | {
      readonly ok: true;
      /** Account ID to the first time it opened any of the Materials. */
      readonly value: ReadonlyMap<string, Date>;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

/**
 * When each Account first opened any of the given Materials. An open is recorded only for a
 * signed-in reader after a visible, permitted render.
 */
export class MaterialFirstOpens {
  constructor(private readonly prisma: ReadingActivityPrismaClient) {}

  async list(materialIds: readonly string[]): Promise<FirstOpensResult> {
    const parsed = materialIdsSchema.safeParse(materialIds);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    if (parsed.data.length === 0) return { ok: true, value: new Map() };
    try {
      const rows = rowsSchema.parse(
        await this.prisma.$queryRaw(Prisma.sql`
        select visit.account_id, min(visit.first_opened_at) as first_opened_at
        from reading_activity.material_visits as visit
        where visit.material_id = any(${parsed.data}::uuid[])
        group by visit.account_id
      `),
      );
      return {
        ok: true,
        value: new Map(
          rows.map((row) => [row.account_id, row.first_opened_at]),
        ),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "reading-activity", operation: "listFirstOpens" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }
}
