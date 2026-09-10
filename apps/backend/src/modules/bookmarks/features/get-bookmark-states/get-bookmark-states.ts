import { z } from "zod";
import type { BookmarksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { BookmarkState } from "../../domain/bookmark.js";
import { toBookmarkState } from "../../shared/bookmark-state-mapping.js";

export const getBookmarkStatesSchema = z.object({ materialIds: z.array(z.uuid()).min(1).max(100) }).strict();
const querySchema = getBookmarkStatesSchema.extend({ accountId: z.uuid() });
export type GetBookmarkStatesResult =
  | { readonly ok: true; readonly value: readonly BookmarkState[] }
  | { readonly ok: false; readonly error:
      | { readonly code: "invalid_request" }
      | { readonly code: "dependency_unavailable" } };

export async function getBookmarkStates(prisma: BookmarksPrismaClient, input: {
  readonly accountId: string;
  readonly materialIds: readonly string[];
}): Promise<GetBookmarkStatesResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const ids = [...new Set(parsed.data.materialIds.map((id) => id.toLowerCase()))];
  try {
    const rows = await prisma.bookmarkedMaterial.findMany({
      where: { accountId: parsed.data.accountId.toLowerCase(), materialId: { in: ids } },
    });
    const states = new Map(rows.map((row) => [row.materialId, row]));
    return { ok: true, value: ids.map((id) => toBookmarkState(id, states.get(id) ?? null)) };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
