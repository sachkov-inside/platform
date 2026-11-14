// @ts-check
import { sourceUuid } from "./markdown.mjs";
/** @typedef {Pick<import("./package.mjs").Manifest, "sourceNamespace">} Manifest
 * @typedef {Pick<import("./package.mjs").ManifestProduct, "sourceId" | "chapters" | "materialIds" | "supplementaryMaterialIds">} ManifestProduct
 */
/** @param {Manifest} manifest @param {string} id */
const sourceKey = (manifest, id) => `${manifest.sourceNamespace}:${id}`;
/**
 * @param {Manifest} manifest
 * @param {ManifestProduct} product
 */
export function productChapters(manifest, product) {
  return product.chapters.map((chapter) => ({
    id: sourceUuid(
      `${sourceKey(manifest, product.sourceId)}:chapter:${chapter.sourceId}`,
    ),
    // The receiver stores chapter text trimmed; comparing it untrimmed would report a change forever.
    name: chapter.title.trim(),
    summary: chapter.summary.trim(),
  }));
}

/**
 * The composition a Product shell release sends: the package's chapter list over the Materials the
 * target already holds, each in its current chapter. Platform requires every chapter's Materials to
 * form one uninterrupted run, so each chapter, in chapter order, lists its Materials by their first
 * programme placement (a different order would rewrite the programme), then the unplaced ones in
 * their current order; unchaptered Materials follow the chapters. A placed Material whose chapter
 * the package drops would lose its placement, so that shell is refused before any write.
 *
 * @param {Manifest} manifest
 * @param {ManifestProduct} product
 * @param {{
 *   items: { materialId: string; chapterId: string | null }[];
 *   programmePlacements?: { materialId: string }[] | undefined;
 * }} order
 */
export function productShellComposition(manifest, product, order) {
  const chapters = productChapters(manifest, product);
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const ungrouped = order.items.filter(
    (item) => item.chapterId !== null && !ids.has(item.chapterId),
  ).length;
  if (ungrouped > 0)
    throw new Error(
      `Product ${product.sourceId}: the Product shell drops chapters that hold ${String(ungrouped)} Materials; move them in Platform or keep those chapters`,
    );
  /** @type {Map<string, number>} */
  const firstPlacement = new Map();
  for (const [index, entry] of (order.programmePlacements ?? []).entries())
    if (!firstPlacement.has(entry.materialId))
      firstPlacement.set(entry.materialId, index);
  /** @param {string | null} chapterId */
  const chapterRun = (chapterId) =>
    order.items
      .filter((item) => item.chapterId === chapterId)
      .map((item) => item.materialId)
      // A stable sort keeps unplaced Materials after the placed ones, in their current order.
      .sort(
        (left, right) =>
          (firstPlacement.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (firstPlacement.get(right) ?? Number.MAX_SAFE_INTEGER),
      );
  return {
    chapters,
    orderedMaterialIds: [
      ...chapters.flatMap((chapter) => chapterRun(chapter.id)),
      ...chapterRun(null),
    ],
  };
}

/**
 * The Product composition shared by preview and apply. The caller resolves source Material IDs:
 * preview can use provisional IDs for new Materials; apply supplies the reserved target IDs.
 * Existing programme positions keep their identities by chapter and occurrence. Omitted attachment
 * metadata stays omitted, so the receiver preserves it instead of clearing it.
 *
 * @param {Manifest} manifest
 * @param {ManifestProduct} product
 * @param {{ programmePlacements?: { id: string; materialId: string; chapterId: string | null; stepGroup: string | null }[] | undefined }} order
 * @param {(sourceId: string) => string} materialId
 */
export function productComposition(manifest, product, order, materialId) {
  const chapters = productChapters(manifest, product).map((chapter, index) => {
    const supplementary = product.chapters[index]?.supplementaryMaterialIds;
    return supplementary === undefined
      ? chapter
      : {
          ...chapter,
          supplementaryMaterialIds: supplementary.map(materialId),
        };
  });
  const chapterAssignments = Object.fromEntries(
    product.chapters.flatMap((chapter, index) => {
      const chapterId = chapters[index]?.id;
      if (chapterId === undefined)
        throw new Error(`Chapter ${chapter.sourceId} has no identity`);
      return chapter.materialIds.map((id) => [materialId(id), chapterId]);
    }),
  );
  const orderedMaterialIds = [
    ...product.materialIds,
    ...product.supplementaryMaterialIds,
  ].map(materialId);
  const programmePlacements =
    product.chapters.length === 0
      ? product.materialIds.map((id) => ({
          id:
            order.programmePlacements?.find(
              (entry) =>
                entry.materialId === materialId(id) && entry.chapterId === null,
            )?.id ??
            sourceUuid(
              `${sourceKey(manifest, product.sourceId)}:programme:${id}`,
            ),
          materialId: materialId(id),
          chapterId: null,
          stepGroup: null,
        }))
      : product.chapters.flatMap((chapter, chapterIndex) => {
          /** @type {Map<string, number>} */
          const occurrence = new Map();
          return chapter.materialIds.map((id) => {
            const count = (occurrence.get(id) ?? 0) + 1;
            occurrence.set(id, count);
            const chapterId = chapters[chapterIndex]?.id ?? null;
            return {
              id:
                order.programmePlacements?.filter(
                  (entry) =>
                    entry.materialId === materialId(id) &&
                    entry.chapterId === chapterId,
                )[count - 1]?.id ??
                sourceUuid(
                  `${sourceKey(manifest, product.sourceId)}:chapter:${chapter.sourceId}:placement:${id}:${String(count)}`,
                ),
              materialId: materialId(id),
              chapterId,
              stepGroup: null,
            };
          });
        });
  return {
    chapters,
    chapterAssignments,
    orderedMaterialIds,
    programmePlacements,
  };
}
