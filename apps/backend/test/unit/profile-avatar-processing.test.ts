import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import {
  PROFILE_AVATAR_LIMITS,
  processProfileAvatar,
} from "../../src/modules/member-profiles/features/change-profile-avatar/process-profile-avatar.js";

describe("Profile avatar processing", () => {
  test("emits only square WebP renditions from a server-validated crop", async () => {
    const body = await sharp({
      create: {
        background: { alpha: 1, b: 80, g: 120, r: 220 },
        channels: 4,
        height: 300,
        width: 400,
      },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processProfileAvatar(upload(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renditions.map(({ contentType, size }) => ({ contentType, size }))).toEqual([
      { contentType: "image/webp", size: 160 },
      { contentType: "image/webp", size: 320 },
      { contentType: "image/webp", size: 640 },
    ]);
    for (const rendition of result.renditions) {
      await expect(sharp(rendition.body).metadata()).resolves.toMatchObject({
        format: "webp",
        height: rendition.size,
        width: rendition.size,
      });
      await expect(sharp(rendition.body).metadata()).resolves.not.toHaveProperty(
        "orientation",
      );
    }
  });

  test("rejects trailing polyglot bytes even when the image decoder accepts them", async () => {
    const valid = await sharp({
      create: {
        background: "#ffffff",
        channels: 3,
        height: 24,
        width: 24,
      },
    }).png().toBuffer();
    const body = Buffer.concat([valid, Buffer.from("<script>alert(1)</script>")]);

    await expect(processProfileAvatar(upload(body))).resolves.toEqual({
      error: { reason: "polyglot_image" },
      ok: false,
    });
  });

  test("fails closed on size, checksum, crop, and decompression-limit violations", async () => {
    const valid = await sharp({
      create: {
        background: "#111111",
        channels: 3,
        height: 24,
        width: 24,
      },
    }).png().toBuffer();
    await expect(
      processProfileAvatar({ ...upload(valid), declaredSize: valid.byteLength + 1 }),
    ).resolves.toEqual({ error: { reason: "size_mismatch" }, ok: false });
    await expect(
      processProfileAvatar({ ...upload(valid), expectedChecksumSha256: "0".repeat(64) }),
    ).resolves.toEqual({ error: { reason: "checksum_mismatch" }, ok: false });
    await expect(
      processProfileAvatar({
        ...upload(valid),
        crop: { centerX: 0, centerY: 0, zoom: 1 },
      }),
    ).resolves.toEqual({ error: { reason: "crop_out_of_bounds" }, ok: false });
    const oversized = Buffer.alloc(PROFILE_AVATAR_LIMITS.bytes + 1, 0);
    await expect(processProfileAvatar(upload(oversized))).resolves.toEqual({
      error: { reason: "image_too_large" },
      ok: false,
    });

    const bombHeader = Buffer.from(valid);
    bombHeader.writeUInt32BE(50_000, 16);
    bombHeader.writeUInt32BE(50_000, 20);
    const bomb = await processProfileAvatar(upload(bombHeader));
    expect(bomb.ok).toBe(false);
  });
});

function upload(body: Uint8Array) {
  return {
    body,
    crop: { centerX: 0.5, centerY: 0.5, zoom: 1 },
    declaredContentType: "image/png",
    declaredSize: body.byteLength,
    expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
  };
}
