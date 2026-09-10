import { z } from "zod";
import type { BookmarksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { RemoveBookmarkCommand, RemoveBookmarkResult } from "./remove-bookmark.contract.js";

const commandSchema = z.object({ accountId: z.uuid(), materialId: z.uuid() }).strict();

export async function removeBookmark(
  prisma: BookmarksPrismaClient,
  input: RemoveBookmarkCommand,
): Promise<RemoveBookmarkResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const account = parsed.data.accountId.toLowerCase();
  const material = parsed.data.materialId.toLowerCase();
  try {
    await prisma.bookmarkedMaterial.deleteMany({
      where: { accountId: account, materialId: material },
    });
    return { ok: true, value: { materialId: material, bookmarked: false, bookmarkedAt: null } };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
