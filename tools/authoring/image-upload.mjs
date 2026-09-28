// @ts-check
import sharp from "sharp";
import { checksum } from "./package.mjs";

/** Platform accepts raster images; editorial SVGs stay unchanged in the source package.
 * @param {Buffer<ArrayBuffer>} bytes
 * @param {import('./package.mjs').ManifestAsset} asset */
export async function imageUpload(bytes, asset) {
  if (asset.mimeType !== "image/svg+xml") return { bytes, asset };
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
