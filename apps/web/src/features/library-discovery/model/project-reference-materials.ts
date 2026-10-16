/** Owner-selected reference identities; callers supply the published Product membership. */
export function projectReferenceMaterials<T extends { readonly slug: string }>(
  items: readonly T[],
): readonly T[] {
  return ["aie-project", "aie-product-brief"].flatMap((slug) => {
    const material =
      items.find((item) => item.slug === `inside-content-${slug}`) ??
      items.find((item) => item.slug === slug);
    return material === undefined ? [] : [material];
  });
}
