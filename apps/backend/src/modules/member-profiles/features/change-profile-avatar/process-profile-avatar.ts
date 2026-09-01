import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import type {
  ProfileAvatarCrop,
  ProfileAvatarInvalidReason,
} from "../../facets/member-profiles/member-profiles.interface.js";

export const PROFILE_AVATAR_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
});

export const PROFILE_AVATAR_SIZES = [160, 320, 640] as const;

export interface ProcessedProfileAvatarRendition {
  readonly body: Uint8Array;
  readonly checksumSha256: string;
  readonly contentType: "image/webp";
  readonly size: (typeof PROFILE_AVATAR_SIZES)[number];
}

export type ProcessProfileAvatarResult =
  | Readonly<{
      ok: true;
      renditions: readonly ProcessedProfileAvatarRendition[];
    }>
  | Readonly<{
      ok: false;
      error: { readonly reason: ProfileAvatarInvalidReason };
    }>;

const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function processProfileAvatar(input: {
  readonly body: Uint8Array;
  readonly crop: ProfileAvatarCrop;
  readonly declaredContentType: string;
  readonly declaredSize: number;
  readonly expectedChecksumSha256: string;
}): Promise<ProcessProfileAvatarResult> {
  if (input.body.byteLength !== input.declaredSize) return failure("size_mismatch");
  if (
    input.body.byteLength === 0 ||
    input.body.byteLength > PROFILE_AVATAR_LIMITS.bytes
  ) {
    return failure("image_too_large");
  }
  const actualChecksum = createHash("sha256").update(input.body).digest("hex");
  if (actualChecksum !== input.expectedChecksumSha256.toLowerCase()) {
    return failure("checksum_mismatch");
  }
  const detected = await fileTypeFromBuffer(input.body);
  if (detected === undefined || !SUPPORTED_CONTENT_TYPES.has(detected.mime)) {
    return failure("unsupported_image_type");
  }
  const declaredContentType = input.declaredContentType
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    declaredContentType !== "application/octet-stream" &&
    declaredContentType !== detected.mime
  ) {
    return failure("mime_mismatch");
  }
  if (!hasExactContainer(input.body, detected.mime)) {
    return failure("polyglot_image");
  }
  if (!isCrop(input.crop)) return failure("crop_out_of_bounds");

  try {
    const options = {
      failOn: "warning" as const,
      limitInputPixels: PROFILE_AVATAR_LIMITS.pixels,
    };
    const metadata = await sharp(input.body, options).metadata();
    if (
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width * metadata.height > PROFILE_AVATAR_LIMITS.pixels
    ) {
      return failure("image_too_large");
    }
    const normalized = await sharp(input.body, options)
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const crop = cropBounds(
      normalized.info.width,
      normalized.info.height,
      input.crop,
    );
    if (crop === null) return failure("crop_out_of_bounds");
    const square = await sharp(normalized.data, options)
      .extract(crop)
      .toBuffer();
    const renditions = await Promise.all(
      PROFILE_AVATAR_SIZES.map(async (size) => {
        const body = await sharp(square, options)
          .resize({ fit: "fill", height: size, width: size })
          .webp({ quality: 86, smartSubsample: true })
          .toBuffer();
        return {
          body,
          checksumSha256: createHash("sha256").update(body).digest("hex"),
          contentType: "image/webp" as const,
          size,
        };
      }),
    );
    return { ok: true, renditions };
  } catch {
    return failure("image_decode_failed");
  }
}

function isCrop(value: ProfileAvatarCrop): boolean {
  return (
    Number.isFinite(value.centerX) &&
    value.centerX >= 0 &&
    value.centerX <= 1 &&
    Number.isFinite(value.centerY) &&
    value.centerY >= 0 &&
    value.centerY <= 1 &&
    Number.isFinite(value.zoom) &&
    value.zoom >= 1 &&
    value.zoom <= 4
  );
}

function cropBounds(
  width: number,
  height: number,
  crop: ProfileAvatarCrop,
): { left: number; top: number; width: number; height: number } | null {
  const side = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
  const left = Math.round(crop.centerX * width - side / 2);
  const top = Math.round(crop.centerY * height - side / 2);
  if (left < 0 || top < 0 || left + side > width || top + side > height) {
    return null;
  }
  return { height: side, left, top, width: side };
}

function hasExactContainer(body: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") {
    if (body[0] !== 0xff || body[1] !== 0xd8) return false;
    for (let index = 2; index < body.length - 1; index += 1) {
      if (body[index] === 0xff && body[index + 1] === 0xd9) {
        return index === body.length - 2;
      }
    }
    return false;
  }
  if (mime === "image/webp") {
    return (
      ascii(body, 0, 4) === "RIFF" &&
      ascii(body, 8, 12) === "WEBP" &&
      readLittleEndianUint32(body, 4) + 8 === body.byteLength
    );
  }
  if (mime === "image/png") return hasExactPngContainer(body);
  return false;
}

function hasExactPngContainer(body: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => body[index] !== byte)) return false;
  let offset = signature.length;
  while (offset + 12 <= body.length) {
    const length = readBigEndianUint32(body, offset);
    const end = offset + 12 + length;
    if (end > body.length) return false;
    const type = ascii(body, offset + 4, offset + 8);
    if (type === "IEND") return length === 0 && end === body.length;
    offset = end;
  }
  return false;
}

function ascii(body: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...body.subarray(start, end));
}

function readLittleEndianUint32(body: Uint8Array, offset: number): number {
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(
    offset,
    true,
  );
}

function readBigEndianUint32(body: Uint8Array, offset: number): number {
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(
    offset,
    false,
  );
}

function failure(reason: ProfileAvatarInvalidReason): ProcessProfileAvatarResult {
  return { error: { reason }, ok: false };
}
