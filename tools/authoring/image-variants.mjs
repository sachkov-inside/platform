// @ts-check
/** Resolve source variant IDs with the same upload map as the original image.
 * @param {import('./package.mjs').ManifestMaterial} page
 * @param {string} href
 * @param {ReadonlyMap<string,string>} images
 */
export function resolveImageVariants(page, href, images) {
  const variants =
    page.imageVariants?.[href] ?? page.imageVariants?.[decodeURI(href)];
  if (variants === undefined) return undefined;
  /** @param {string} id */
  const resolve = (id) => {
    const assetId = images.get(id);
    if (assetId === undefined)
      throw new Error(`${page.sourcePath}: unresolved image variant: ${id}`);
    return assetId;
  };
  return {
    wideLight: resolve(variants.wideLight),
    wideDark: resolve(variants.wideDark),
    tallLight: resolve(variants.tallLight),
    tallDark: resolve(variants.tallDark),
  };
}
