import { createHash } from "node:crypto";
import { extname } from "node:path";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export const MATERIAL_ASSET_LIMITS = Object.freeze({
  fileBytes: 25 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  imagePixels: 40_000_000,
});

const IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const EXECUTABLE_EXTENSIONS = new Set([
  ".apk",
  ".app",
  ".bash",
  ".bat",
  ".cjs",
  ".cmd",
  ".com",
  ".command",
  ".dll",
  ".exe",
  ".fish",
  ".htm",
  ".html",
  ".hta",
  ".jar",
  ".js",
  ".lua",
  ".mjs",
  ".msi",
  ".php",
  ".php3",
  ".php4",
  ".php5",
  ".phtml",
  ".pl",
  ".pm",
  ".ps1",
  ".py",
  ".pyw",
  ".r",
  ".rb",
  ".sh",
  ".svg",
  ".vbe",
  ".vbs",
  ".wasm",
  ".wsf",
  ".wsh",
  ".xhtml",
  ".xml",
  ".xsl",
  ".zsh",
]);
const EXECUTABLE_CONTENT_TYPES = new Set([
  "application/java-archive",
  "application/javascript",
  "application/vbscript",
  "application/vnd.microsoft.portable-executable",
  "application/wasm",
  "application/x-csh",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-httpd-php",
  "application/x-msdownload",
  "application/x-perl",
  "application/x-php",
  "application/x-python-code",
  "application/x-ruby",
  "application/x-sh",
  "application/x-shellscript",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/html",
  "text/javascript",
  "text/vbscript",
  "text/xml",
  "text/x-lua",
  "text/x-perl",
  "text/x-php",
  "text/x-python",
  "text/x-ruby",
  "text/x-script.python",
]);
const VIDEO_EXTENSIONS = new Set([
  ".3g2",
  ".3gp",
  ".avi",
  ".flv",
  ".m2ts",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".mts",
  ".ogv",
  ".ts",
  ".webm",
  ".wmv",
]);
const RESPONSIVE_WIDTHS = [480, 960, 1600] as const;

export type MaterialAssetProcessingError = Readonly<{
  code:
    | "checksum_mismatch"
    | "executable_content"
    | "image_decode_failed"
    | "image_too_large"
    | "mime_mismatch"
    | "size_mismatch"
    | "unsupported_file_type"
    | "unsupported_image_type";
}>;

interface ProcessedBinary {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export type ProcessedMaterialAsset =
  | Readonly<{
      body: Uint8Array;
      checksumSha256: string;
      contentType: string;
      kind: "file";
      size: number;
    }>
  | Readonly<{
      checksumSha256: string;
      contentType: string;
      height: number;
      kind: "image";
      original: ProcessedBinary;
      size: number;
      variants: readonly (ProcessedBinary & {
        readonly height: number;
        readonly width: number;
      })[];
      width: number;
    }>;

export type ProcessMaterialAssetBytesResult =
  | { readonly ok: true; readonly value: ProcessedMaterialAsset }
  | { readonly ok: false; readonly error: MaterialAssetProcessingError };

export async function processMaterialAssetBytes(input: {
  readonly body: Uint8Array;
  readonly declaredContentType: string;
  readonly declaredSize: number;
  readonly expectedChecksumSha256: string;
  readonly filename: string;
  readonly kind: "file" | "image";
}): Promise<ProcessMaterialAssetBytesResult> {
  if (input.body.byteLength !== input.declaredSize) {
    return failure("size_mismatch");
  }
  const byteLimit =
    input.kind === "image"
      ? MATERIAL_ASSET_LIMITS.imageBytes
      : MATERIAL_ASSET_LIMITS.fileBytes;
  if (input.body.byteLength === 0 || input.body.byteLength > byteLimit) {
    return failure(input.kind === "image" ? "image_too_large" : "size_mismatch");
  }
  const checksumSha256 = createHash("sha256").update(input.body).digest("hex");
  if (checksumSha256 !== input.expectedChecksumSha256.toLowerCase()) {
    return failure("checksum_mismatch");
  }

  const detected = await fileTypeFromBuffer(input.body);
  const declaredContentType = normalizeContentType(input.declaredContentType);
  if (input.kind === "image") {
    if (detected === undefined || !IMAGE_CONTENT_TYPES.has(detected.mime)) {
      return failure("unsupported_image_type");
    }
    if (
      declaredContentType !== "application/octet-stream" &&
      declaredContentType !== detected.mime
    ) {
      return failure("mime_mismatch");
    }
    return processImage(input.body, checksumSha256, detected.mime);
  }

  const actualContentType = detected?.mime ?? inferTextContentType(
    declaredContentType,
    input.body,
  );
  if (
    declaredContentType !== "application/octet-stream" &&
    declaredContentType !== actualContentType
  ) {
    return failure("mime_mismatch");
  }
  if (
    actualContentType.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(extname(input.filename).toLowerCase())
  ) {
    return failure("unsupported_file_type");
  }
  if (
    isExecutableContent(input.filename, actualContentType, input.body)
  ) {
    return failure("executable_content");
  }
  return {
    ok: true,
    value: {
      body: input.body,
      checksumSha256,
      contentType: actualContentType,
      kind: "file",
      size: input.body.byteLength,
    },
  };
}

function inferTextContentType(
  declaredContentType: string,
  body: Uint8Array,
): string {
  const mayBeText =
    declaredContentType.startsWith("text/") ||
    declaredContentType === "application/graphql" ||
    declaredContentType === "application/json" ||
    declaredContentType === "application/sql" ||
    declaredContentType === "application/toml" ||
    declaredContentType === "application/xml" ||
    declaredContentType === "application/x-yaml" ||
    declaredContentType === "application/yaml" ||
    declaredContentType.endsWith("+json") ||
    declaredContentType.endsWith("+xml") ||
    EXECUTABLE_CONTENT_TYPES.has(declaredContentType);
  if (!mayBeText) return "application/octet-stream";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return text.includes("\u0000")
      ? "application/octet-stream"
      : declaredContentType;
  } catch {
    return "application/octet-stream";
  }
}

async function processImage(
  body: Uint8Array,
  checksumSha256: string,
  contentType: string,
): Promise<ProcessMaterialAssetBytesResult> {
  try {
    const metadata = await sharp(body, {
      failOn: "warning",
      limitInputPixels: MATERIAL_ASSET_LIMITS.imagePixels,
    }).metadata();
    if (
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width * metadata.height > MATERIAL_ASSET_LIMITS.imagePixels
    ) {
      return failure("image_too_large");
    }
    const normalized = await sharp(body, {
      failOn: "warning",
      limitInputPixels: MATERIAL_ASSET_LIMITS.imagePixels,
    })
      .rotate()
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const width = normalized.info.width;
    const height = normalized.info.height;
    const variantWidths = [
      ...new Set(RESPONSIVE_WIDTHS.map((candidate) => Math.min(candidate, width))),
    ].toSorted((left, right) => left - right);
    const variants = await Promise.all(
      variantWidths.map(async (variantWidth) => {
        const variant = await sharp(normalized.data)
          .resize({ fit: "inside", width: variantWidth, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        return {
          body: variant.data,
          contentType: "image/webp",
          height: variant.info.height,
          width: variant.info.width,
        };
      }),
    );
    return {
      ok: true,
      value: {
        checksumSha256,
        contentType,
        height,
        kind: "image",
        original: { body: normalized.data, contentType: "image/webp" },
        size: body.byteLength,
        variants,
        width,
      },
    };
  } catch {
    return failure("image_decode_failed");
  }
}

function isExecutableContent(
  filename: string,
  contentType: string,
  body: Uint8Array,
): boolean {
  if (
    EXECUTABLE_EXTENSIONS.has(extname(filename).toLowerCase()) ||
    EXECUTABLE_CONTENT_TYPES.has(contentType)
  ) {
    return true;
  }
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(body.subarray(0, 1024))
    .trimStart()
    .toLowerCase();
  return (
    prefix.startsWith("#!") ||
    prefix.startsWith("<!doctype html") ||
    prefix.startsWith("<html") ||
    prefix.startsWith("<script") ||
    prefix.startsWith("<svg")
  );
}

function normalizeContentType(value: string): string {
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === undefined || contentType.length === 0
    ? "application/octet-stream"
    : contentType;
}

function failure(
  code: MaterialAssetProcessingError["code"],
): ProcessMaterialAssetBytesResult {
  return { error: { code }, ok: false };
}
