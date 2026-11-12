// @ts-check
import sharp from "sharp";
import { checksum } from "./package.mjs";

/** The receiver feature that stores a checked SVG Material image as SVG (#2025). */
export const SVG_IMAGES_FEATURE = "svg-images-v1";

/** A receiver that reports `svg-images-v1` gets the editorial SVG unchanged and keeps its
 * animation. An older receiver accepts raster images only, so the SVG becomes a PNG there; the
 * source package keeps the SVG either way.
 * @param {Buffer<ArrayBuffer>} bytes
 * @param {import('./package.mjs').ManifestAsset} asset
 * @param {readonly string[]} receiverFeatures `packageFeatures` from the receiver's contract */
export async function imageUpload(bytes, asset, receiverFeatures) {
  if (asset.mimeType !== "image/svg+xml") return { bytes, asset };
  if (receiverFeatures.includes(SVG_IMAGES_FEATURE)) return { bytes, asset };
  const png = await sharp(bytes, { density: 144, limitInputPixels: 40_000_000 })
    .png()
    .toBuffer();
  return {
    bytes: png,
    asset: {
      ...asset,
      path: `${asset.path}.png`,
      mimeType: "image/png",
      sha256: checksum(png),
    },
  };
}
