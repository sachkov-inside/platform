import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  lockBookmarkPair,
  type BookmarksPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { materialId } from "../../../materials/index.js";
import type {
  AddBookmarkCommand,
  AddBookmarkResult,
} from "./add-bookmark.contract.js";

const commandSchema = z
  .object({ accountId: z.uuid(), materialId: z.uuid() })
  .strict();

export async function addBookmark(
  dependencies: {
    readonly prisma: BookmarksPrismaClient;
    readonly contentAccess: Pick<ContentAccess, "authorize">;
  },
  input: AddBookmarkCommand,
): Promise<AddBookmarkResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const account = parsed.data.accountId.toLowerCase();
  const material = parsed.data.materialId.toLowerCase();
  const decision = await dependencies.contentAccess.authorize({
    subject: { kind: "account", accountId: accountId(account) },
    action: "read",
    resource: { kind: "material", materialId: materialId(material) },
    enforcementPoint: "bookmark_change",
    correlationId: randomUUID(),
  });
  if (decision.effect === "deny")
    return {
      ok: false,
      error: {
        code:
          decision.reason === "dependency_unavailable"
            ? "dependency_unavailable"
            : "access_denied",
      },
    };
  try {
    return await dependencies.prisma.$transaction(async (transaction) => {
      await lockBookmarkPair(transaction, account, material);
      const bookmarkedAt = new Date();
      const changed = await transaction.bookmarkedMaterial.createMany({
        data: [{ accountId: account, materialId: material, bookmarkedAt }],
        skipDuplicates: true,
      });
      if (changed.count > 0)
        await transaction.$executeRaw(Prisma.sql`
        insert into bookmarks.activity_events (event_id, account_id, material_id, event_type, occurred_at)
        values (${randomUUID()}::uuid, ${account}::uuid, ${material}::uuid, 'bookmark_added', ${bookmarkedAt})
      `);
      const row = await transaction.bookmarkedMaterial.findUnique({
        where: {
          accountId_materialId: { accountId: account, materialId: material },
        },
      });
      return {
        ok: true as const,
        value: {
          materialId: material,
          bookmarked: true as const,
          bookmarkedAt: (row?.bookmarkedAt ?? bookmarkedAt).toISOString(),
        },
      };
    });
  } catch (error) {
    return dependencyFailure(
      { module: "bookmarks", operation: "addBookmark" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
