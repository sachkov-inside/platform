// @ts-check
import MarkdownIt from "markdown-it";

const parser = new MarkdownIt();
/** Match a parser-normalized address while retaining the package's original spelling.
 * @param {Readonly<Record<string, unknown>>} sources
 * @param {string} href
 */
export function imageSourceKey(sources, href) {
  return Object.hasOwn(sources, href)
    ? href
    : Object.keys(sources).find(
        (source) => parser.normalizeLink(source) === href,
      );
}

/** Resolve source variant IDs with the same upload map as the original image.
 * @param {Pick<import('./package.mjs').ManifestMaterial, 'sourcePath' | 'imageVariants'>} page
 * @param {string} href
 * @param {ReadonlyMap<string,string>} images
 */
export function resolveImageVariants(page, href, images) {
  const sourceSrc = imageSourceKey(page.imageVariants ?? {}, href);
  const variants =
    sourceSrc === undefined ? undefined : page.imageVariants?.[sourceSrc];
  if (variants === undefined || sourceSrc === undefined) return undefined;
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
