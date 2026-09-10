import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BookmarksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { materialId } from "../../../materials/index.js";
import type { AddBookmarkCommand, AddBookmarkResult } from "./add-bookmark.contract.js";

const commandSchema = z.object({ accountId: z.uuid(), materialId: z.uuid() }).strict();

export async function addBookmark(dependencies: {
  readonly prisma: BookmarksPrismaClient;
  readonly contentAccess: Pick<ContentAccess, "authorize">;
}, input: AddBookmarkCommand): Promise<AddBookmarkResult> {
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
  if (decision.effect === "deny") return {
    ok: false,
    error: { code: decision.reason === "dependency_unavailable" ? "dependency_unavailable" : "access_denied" },
  };
  try {
    const bookmarkedAt = new Date();
    await dependencies.prisma.bookmarkedMaterial.createMany({
      data: [{ accountId: account, materialId: material, bookmarkedAt }],
      skipDuplicates: true,
    });
    const row = await dependencies.prisma.bookmarkedMaterial.findUnique({
      where: { accountId_materialId: { accountId: account, materialId: material } },
    });
    return {
      ok: true,
      value: { materialId: material, bookmarked: true, bookmarkedAt: (row?.bookmarkedAt ?? bookmarkedAt).toISOString() },
    };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
