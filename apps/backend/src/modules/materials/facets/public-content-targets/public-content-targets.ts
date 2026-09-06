import { z } from "zod";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";

const targetSchema = z.object({
  kind: z.enum(["material", "series"]),
  slug: z.string().min(1).max(120),
});
export type PublicContentTarget = z.infer<typeof targetSchema>;
export type PublicContentTargetResult = {
  targetId: string | null;
  reason:
    "eligible" | "not_found" | "not_published" | "not_free" | "incomplete";
};
/** Materials owns whether a promised public target is complete and free. */
export class PublicContentTargets {
  constructor(private readonly prisma: MaterialsPrismaClient) {}
  async check(input: PublicContentTarget): Promise<PublicContentTargetResult> {
    const target = targetSchema.parse(input);
    if (target.kind === "material") {
      const material = await this.prisma.material.findUnique({
        where: { slug: target.slug },
        select: { id: true, publicationState: true, access: true },
      });
      if (!material) return { targetId: null, reason: "not_found" };
      return {
        targetId: material.id,
        reason:
          material.publicationState !== "published"
            ? "not_published"
            : material.access !== "free"
              ? "not_free"
              : "eligible",
      };
    }
    const series = await this.prisma.series.findUnique({
      where: { slug: target.slug },
      select: { id: true, archivedAt: true },
    });
    if (!series) return { targetId: null, reason: "not_found" };
    if (series.archivedAt)
      return { targetId: series.id, reason: "not_published" };
    const membership = await this.prisma.seriesMembership.findMany({
      where: { seriesId: series.id },
      select: { materialId: true },
    });
    if (membership.length === 0)
      return { targetId: series.id, reason: "incomplete" };
    const materials = await this.prisma.material.findMany({
      where: { id: { in: membership.map((member) => member.materialId) } },
      select: { publicationState: true, access: true },
    });
    return {
      targetId: series.id,
      reason:
        materials.length !== membership.length ||
        materials.some((material) => material.publicationState !== "published")
          ? "incomplete"
          : materials.some((material) => material.access !== "free")
            ? "not_free"
            : "eligible",
    };
  }
}
