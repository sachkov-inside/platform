import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialAnnouncement } from "@inside/contracts/material-announcements";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";

/** Public feed announcements only. Cursor follows source rows, including rows filtered out later. */
export class PublicMaterialAnnouncements {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  async read(
    input: { after?: string | undefined; announcementRef?: string | undefined },
    origin: string,
    now: Date,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly items: MaterialAnnouncement[];
          readonly nextCursor: string | null;
        };
      }
    | {
        readonly ok: false;
        readonly error: { readonly code: "dependency_unavailable" };
      }
  > {
    try {
      const announcements = await this.prisma.materialAnnouncement.findMany({
        where: {
          telegramEnabled: true,
          notAfter: { gt: now },
          occurredAt: { lte: now },
          ...(input.announcementRef === undefined
            ? {}
            : { id: input.announcementRef }),
          ...(input.after === undefined ? {} : { id: { gt: input.after } }),
        },
        orderBy: { id: "asc" },
        take: 51,
      });
      const page = announcements.slice(0, 50);
      const materials = await this.prisma.material.findMany({
        where: {
          id: { in: page.map((row) => row.materialId) },
          publicationState: "published",
          access: "free",
          showInFeed: true,
          notifyTelegram: true,
        },
        select: { id: true, title: true, summary: true, slug: true },
      });
      const current = new Map(materials.map((row) => [row.id, row]));
      const items: MaterialAnnouncement[] = page.flatMap((announcement) => {
        const material = current.get(announcement.materialId);
        if (
          material?.title == null ||
          material.summary === null ||
          material.slug === null
        )
          return [];
        return [
          {
            announcementRef: announcement.id,
            materialId: material.id,
            title: material.title,
            summary: material.summary,
            url: new URL(`/materials/${material.slug}`, origin).href,
            occurredAt: announcement.occurredAt.toISOString(),
            notAfter: announcement.notAfter.toISOString(),
          },
        ];
      });
      return {
        ok: true,
        value: {
          items,
          nextCursor:
            announcements.length > 50 ? (page.at(-1)?.id ?? null) : null,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "readPublicAnnouncements" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } },
      );
    }
  }
}
