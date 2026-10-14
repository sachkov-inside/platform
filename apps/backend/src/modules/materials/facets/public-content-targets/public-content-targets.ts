import { z } from "zod";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";

const targetSchema = z.object({
  kind: z.enum(["material", "series", "product"]),
  slug: z.string().min(1).max(120),
});
export type PublicContentTarget = z.infer<typeof targetSchema>;
export type PublicContentTargetResult = {
  targetId: string | null;
  reason:
    "eligible" | "not_found" | "not_published" | "not_free" | "incomplete";
};
/** Materials owns public destinations; a Product page does not promise free Material bodies. */
export class PublicContentTargets {
  constructor(private readonly prisma: MaterialsPrismaClient) {}
  static parseUrl(url: URL): PublicContentTarget | "invalid" | null {
    const route = url.pathname.split("/")[1];
    if (
      route !== "materials" &&
      route !== "products" &&
      route !== "series" &&
      route !== "guides"
    )
      return null;
    if (
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      return "invalid";
    const match =
      /^\/(?:materials|products|series|guides)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(
        url.pathname,
      );
    const slug = match?.[1];
    if (slug === undefined || slug.length > 120) return "invalid";
    return { kind: route === "materials" ? "material" : "product", slug };
  }
  /** Bounded owner reads; results retain the input order, including repeated URL aliases. */
  async checkMany(
    input: readonly PublicContentTarget[],
  ): Promise<readonly PublicContentTargetResult[]> {
    const targets = targetSchema.array().parse(input);
    const materialSlugs = [
      ...new Set(
        targets
          .filter((target) => target.kind === "material")
          .map((target) => target.slug),
      ),
    ];
    const productSlugs = [
      ...new Set(
        targets
          .filter((target) => target.kind !== "material")
          .map((target) => target.slug),
      ),
    ];
    const materials = new Map<
      string,
      { id: string; publicationState: string; access: string }
    >();
    const products = new Map<string, { id: string; archivedAt: Date | null }>();
    const batchSize = 100;
    for (let start = 0; start < materialSlugs.length; start += batchSize) {
      const rows = await this.prisma.material.findMany({
        where: { slug: { in: materialSlugs.slice(start, start + batchSize) } },
        select: { id: true, slug: true, publicationState: true, access: true },
      });
      for (const row of rows)
        if (row.slug !== null) materials.set(row.slug, row);
    }
    for (let start = 0; start < productSlugs.length; start += batchSize) {
      const rows = await this.prisma.product.findMany({
        where: { slug: { in: productSlugs.slice(start, start + batchSize) } },
        select: { id: true, slug: true, archivedAt: true },
      });
      for (const row of rows) products.set(row.slug, row);
    }
    const seriesIds = [
      ...new Set(
        targets.flatMap((target) => {
          const product = products.get(target.slug);
          return target.kind === "series" && product?.archivedAt === null
            ? [product.id]
            : [];
        }),
      ),
    ];
    const memberIds = new Map<string, string[]>();
    for (let start = 0; start < seriesIds.length; start += batchSize) {
      const rows = await this.prisma.productMembership.findMany({
        where: { seriesId: { in: seriesIds.slice(start, start + batchSize) } },
        select: { seriesId: true, materialId: true },
      });
      for (const row of rows) {
        const ids = memberIds.get(row.seriesId) ?? [];
        ids.push(row.materialId);
        memberIds.set(row.seriesId, ids);
      }
    }
    const ids = [...new Set([...memberIds.values()].flat())];
    const memberFacts = new Map<
      string,
      { publicationState: string; access: string }
    >();
    for (let start = 0; start < ids.length; start += batchSize) {
      const rows = await this.prisma.material.findMany({
        where: { id: { in: ids.slice(start, start + batchSize) } },
        select: { id: true, publicationState: true, access: true },
      });
      for (const row of rows) memberFacts.set(row.id, row);
    }
    return targets.map((target): PublicContentTargetResult => {
      if (target.kind === "material") {
        const material = materials.get(target.slug);
        return material === undefined
          ? { targetId: null, reason: "not_found" }
          : {
              targetId: material.id,
              reason:
                material.publicationState !== "published"
                  ? "not_published"
                  : material.access !== "free"
                    ? "not_free"
                    : "eligible",
            };
      }
      const product = products.get(target.slug);
      if (product === undefined) return { targetId: null, reason: "not_found" };
      if (product.archivedAt !== null)
        return { targetId: product.id, reason: "not_published" };
      if (target.kind === "product")
        return { targetId: product.id, reason: "eligible" };
      const members = memberIds.get(product.id) ?? [];
      const incomplete =
        members.length === 0 ||
        members.some(
          (id) => memberFacts.get(id)?.publicationState !== "published",
        );
      return {
        targetId: product.id,
        reason: incomplete
          ? "incomplete"
          : members.some((id) => memberFacts.get(id)?.access !== "free")
            ? "not_free"
            : "eligible",
      };
    });
  }

  async check(input: PublicContentTarget): Promise<PublicContentTargetResult> {
    const [result] = await this.checkMany([input]);
    if (result === undefined)
      throw new Error("Public target set omitted a result");
    return result;
  }
}
