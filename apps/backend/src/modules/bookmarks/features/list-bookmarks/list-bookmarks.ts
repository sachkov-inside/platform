import { z } from "zod";
import type { BookmarksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { readPublishedCatalogItems } from "../../../content-library/index.js";
import type { PublishedMaterialSelection } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import type { ListBookmarksQuery, ListBookmarksResult } from "./list-bookmarks.contract.js";

const querySchema = z.object({
  accountId: z.uuid(),
  first: z.number().int().min(1).max(24),
  after: z.string().min(1).max(512).optional(),
}).strict();

interface BookmarkCursor {
  readonly bookmarkedAt: string;
  readonly materialId: string;
}

export async function listBookmarks(dependencies: {
  readonly prisma: BookmarksPrismaClient;
  readonly selection: Pick<PublishedMaterialSelection, "read">;
  readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">;
  readonly videos: Pick<Videos, "loadReadyDurations">;
}, input: ListBookmarksQuery): Promise<ListBookmarksResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const cursor = parsed.data.after === undefined ? null : decodeCursor(parsed.data.after);
  if (parsed.data.after !== undefined && cursor === null) {
    return { ok: false, error: { code: "invalid_request" } };
  }
  const account = parsed.data.accountId.toLowerCase();
  try {
    const rows = await dependencies.prisma.bookmarkedMaterial.findMany({
      where: cursor === null
        ? { accountId: account }
        : {
            accountId: account,
            OR: [
              { bookmarkedAt: { lt: new Date(cursor.bookmarkedAt) } },
              { bookmarkedAt: new Date(cursor.bookmarkedAt), materialId: { lt: cursor.materialId } },
            ],
          },
      orderBy: [{ bookmarkedAt: "desc" }, { materialId: "desc" }],
      take: parsed.data.first + 1,
    });
    const hasNext = rows.length > parsed.data.first;
    const page = rows.slice(0, parsed.data.first);
    if (page.length === 0) return { ok: true, value: { items: [], nextCursor: null } };
    const projected = await readPublishedCatalogItems(
      dependencies,
      { kind: "account", accountId: accountId(account) },
      page.map((row) => row.materialId),
    );
    if (!projected.ok) return { ok: false, error: { code: "dependency_unavailable" } };
    const byId = new Map(projected.items.map((item) => [item.materialId, item]));
    const items = page.flatMap((row) => {
      const item = byId.get(row.materialId);
      return item === undefined ? [] : [item];
    });
    const last = page[page.length - 1];
    if (last === undefined) return { ok: true, value: { items, nextCursor: null } };
    return {
      ok: true,
      value: {
        items,
        nextCursor: hasNext
          ? encodeCursor({ bookmarkedAt: last.bookmarkedAt.toISOString(), materialId: last.materialId })
          : null,
      },
    };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}

function decodeCursor(value: string): BookmarkCursor | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = z.object({
      v: z.literal(1),
      bookmarkedAt: z.iso.datetime(),
      materialId: z.uuid(),
    }).strict().safeParse(decoded);
    return parsed.success
      ? { bookmarkedAt: parsed.data.bookmarkedAt, materialId: parsed.data.materialId }
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: BookmarkCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url");
}
