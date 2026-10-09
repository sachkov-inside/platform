// @ts-check
/** Resolve source variant IDs with the same upload map as the original image.
 * @param {import('./package.mjs').ManifestMaterial} page
 * @param {string} href
 * @param {ReadonlyMap<string,string>} images
 */
export function resolveImageVariants(page, href, images) {
  const sourceSrc =
    page.imageVariants?.[href] === undefined ? decodeURI(href) : href;
  const variants = page.imageVariants?.[sourceSrc];
  if (variants === undefined) return undefined;
  /** @param {string} id */
  const resolve = (id) => {
    const assetId = images.get(id);
    if (assetId === undefined)
      throw new Error(`${page.sourcePath}: unresolved image variant: ${id}`);
    return assetId;
  };
  return {
    sourceSrc,
    imageVariants: {
      wideLight: resolve(variants.wideLight),
      wideDark: resolve(variants.wideDark),
      tallLight: resolve(variants.tallLight),
      tallDark: resolve(variants.tallDark),
    },
  };
}
