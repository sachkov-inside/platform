// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { imageUpload, SVG_IMAGES_FEATURE } from "./image-upload.mjs";
import { checksum } from "./package.mjs";

const svgBytes = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="red"/></svg>',
);
const svgAsset = {
  sourceId: "diagram",
  path: "assets/diagram.svg",
  mimeType: "image/svg+xml",
  sha256: checksum(svgBytes),
};

test("editorial SVG uploads unchanged when the receiver reports svg-images-v1 (#2025)", async () => {
  const upload = await imageUpload(svgBytes, svgAsset, [
    "image-variants-v1",
    SVG_IMAGES_FEATURE,
  ]);
  assert.equal(SVG_IMAGES_FEATURE, "svg-images-v1");
  assert.deepEqual(upload, { bytes: svgBytes, asset: svgAsset });
});

test("editorial SVG uploads as a decodable PNG to a receiver without svg-images-v1", async () => {
  const upload = await imageUpload(svgBytes, svgAsset, ["image-variants-v1"]);
  assert.equal(upload.asset.mimeType, "image/png");
  assert.equal(upload.asset.sha256, checksum(upload.bytes));
  assert.equal((await sharp(upload.bytes).metadata()).format, "png");
  assert.equal(svgAsset.mimeType, "image/svg+xml");
  assert.equal(svgAsset.sha256, checksum(svgBytes));
  assert.deepEqual(await imageUpload(upload.bytes, upload.asset, []), upload);
});
