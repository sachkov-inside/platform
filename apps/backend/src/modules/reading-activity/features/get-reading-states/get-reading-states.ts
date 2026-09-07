import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ReadingState } from "../../domain/reading-state.js";
import { toReadingState } from "../../shared/reading-state-mapping.js";

export const getReadingStatesSchema = z.object({ materialIds: z.array(z.uuid()).min(1).max(100) }).strict();
const querySchema = getReadingStatesSchema.extend({ accountId: z.uuid() });
export type GetReadingStatesResult =
  | { readonly ok: true; readonly value: readonly ReadingState[] }
  | { readonly ok: false; readonly error:
      | { readonly code: "invalid_request" }
      | { readonly code: "dependency_unavailable" } };

export async function getReadingStates(prisma: ReadingActivityPrismaClient, input: {
  readonly accountId: string;
  readonly materialIds: readonly string[];
}): Promise<GetReadingStatesResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const ids = [...new Set(parsed.data.materialIds.map((id) => id.toLowerCase()))];
  try {
    const rows = await prisma.readingMaterialState.findMany({
      where: { accountId: parsed.data.accountId.toLowerCase(), materialId: { in: ids } },
    });
    const states = new Map(rows.map((row) => [row.materialId, row]));
    return { ok: true, value: ids.map((id) => toReadingState(id, states.get(id) ?? null)) };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
