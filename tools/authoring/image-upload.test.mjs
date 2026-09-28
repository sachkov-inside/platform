// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { imageUpload } from "./image-upload.mjs";
import { checksum } from "./package.mjs";

test("editorial SVG uploads as a decodable PNG with a checksum of the delivered bytes", async () => {
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="red"/></svg>',
  );
  const asset = {
    sourceId: "diagram",
    path: "assets/diagram.svg",
    mimeType: "image/svg+xml",
    sha256: checksum(bytes),
  };
  const upload = await imageUpload(bytes, asset);
  assert.equal(upload.asset.mimeType, "image/png");
  assert.equal(upload.asset.sha256, checksum(upload.bytes));
  assert.equal((await sharp(upload.bytes).metadata()).format, "png");
  assert.equal(asset.mimeType, "image/svg+xml");
  assert.equal(asset.sha256, checksum(bytes));
  assert.deepEqual(await imageUpload(upload.bytes, upload.asset), upload);
});
