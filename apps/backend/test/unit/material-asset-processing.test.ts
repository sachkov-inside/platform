import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { processMaterialAssetBytes } from "../../src/modules/assets/facets/material-assets/process-material-asset-bytes.js";

function checksum(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

describe("MaterialAsset byte processing", () => {
  test("decodes an image, strips metadata and creates bounded responsive variants", async () => {
    const uploaded = await sharp({
      create: {
        background: { alpha: 1, b: 90, g: 80, r: 70 },
        channels: 4,
        height: 1200,
        width: 1800,
      },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: "private author metadata" } })
      .toBuffer();

    const result = await processMaterialAssetBytes({
      body: uploaded,
      declaredContentType: "image/jpeg",
      declaredSize: uploaded.byteLength,
      expectedChecksumSha256: checksum(uploaded),
      filename: "architecture-map.jpg",
      kind: "image",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "image") {
      throw new Error("Expected processed image");
    }
    expect(result.value).toMatchObject({
      checksumSha256: checksum(uploaded),
      contentType: "image/jpeg",
      height: 1200,
      kind: "image",
      width: 1800,
    });
    expect(result.value.variants.map(({ width }) => width)).toEqual([480, 960, 1600]);
    expect(result.value.variants.every(({ contentType }) => contentType === "image/webp")).toBe(true);
    const originalMetadata = await sharp(result.value.original.body).metadata();
    expect(originalMetadata.format).toBe("webp");
    expect(originalMetadata.exif).toBeUndefined();
    expect(originalMetadata.width).toBe(1800);
    expect(originalMetadata.height).toBe(1200);
  });

  test("rejects checksum mismatch and script-like downloadable content", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\nexample");
    await expect(
      processMaterialAssetBytes({
        body: pdf,
        declaredContentType: "application/pdf",
        declaredSize: pdf.byteLength,
        expectedChecksumSha256: "0".repeat(64),
        filename: "guide.pdf",
        kind: "file",
      }),
    ).resolves.toEqual({ error: { code: "checksum_mismatch" }, ok: false });

    const script = new TextEncoder().encode("#!/usr/bin/env node\nconsole.log('unsafe')");
    await expect(
      processMaterialAssetBytes({
        body: script,
        declaredContentType: "text/plain",
        declaredSize: script.byteLength,
        expectedChecksumSha256: checksum(script),
        filename: "notes.txt",
        kind: "file",
      }),
    ).resolves.toEqual({ error: { code: "executable_content" }, ok: false });
  });
});
