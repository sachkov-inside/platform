import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  lockBookmarkPair,
  type BookmarksPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type {
  RemoveBookmarkCommand,
  RemoveBookmarkResult,
} from "./remove-bookmark.contract.js";

const commandSchema = z
  .object({ accountId: z.uuid(), materialId: z.uuid() })
  .strict();

export async function removeBookmark(
  prisma: BookmarksPrismaClient,
  input: RemoveBookmarkCommand,
): Promise<RemoveBookmarkResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const account = parsed.data.accountId.toLowerCase();
  const material = parsed.data.materialId.toLowerCase();
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockBookmarkPair(transaction, account, material);
      const changed = await transaction.bookmarkedMaterial.deleteMany({
        where: { accountId: account, materialId: material },
      });
      if (changed.count > 0)
        await transaction.$executeRaw(Prisma.sql`
        insert into bookmarks.activity_events (event_id, account_id, material_id, event_type, occurred_at)
        values (${randomUUID()}::uuid, ${account}::uuid, ${material}::uuid, 'bookmark_removed', ${new Date()})
      `);
      return {
        ok: true as const,
        value: {
          materialId: material,
          bookmarked: false as const,
          bookmarkedAt: null,
        },
      };
    });
  } catch (error) {
    return dependencyFailure(
      { module: "bookmarks", operation: "removeBookmark" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
