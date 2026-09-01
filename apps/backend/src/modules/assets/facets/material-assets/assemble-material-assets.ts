import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";

import { Prisma, type AssetsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { processMaterialAssetBytes } from "./process-material-asset-bytes.js";
import type {
  MaterialAssetDelivery,
  MaterialAssetDto,
  MaterialAssetPresentation,
  MaterialAssetQueryResult,
  MaterialAssetReference,
  MaterialAssetReferenceIssue,
  MaterialAssets,
  UploadMaterialAssetResult,
} from "./material-assets.js";

const uuidSchema = z.uuid();
const sha256Schema = z.hash("sha256");

export function assembleMaterialAssets(dependencies: {
  readonly objectStorage: ObjectStorage;
  readonly prisma: AssetsPrismaClient;
}): MaterialAssets {
  const { objectStorage, prisma } = dependencies;
  const assets: MaterialAssets = {
    async upload(input): Promise<UploadMaterialAssetResult> {
      const validated = validateUpload(input);
      if (validated === null) {
        return { error: { code: "invalid_upload" }, ok: false };
      }
      const fingerprint = fingerprintUpload(validated);
      const existing = await prisma.materialAsset.findUnique({
        where: {
          materialId_uploadedBy_idempotencyKey: {
            idempotencyKey: validated.idempotencyKey,
            materialId: validated.materialId,
            uploadedBy: validated.actor,
          },
        },
        include: { materialAssetVariants: true },
      });
      if (existing !== null) {
        if (existing.requestFingerprint !== fingerprint) {
          return { error: { code: "idempotency_key_reused" }, ok: false };
        }
        if (existing.state === "ready") {
          return { ok: true, value: toDto(existing) };
        }
        if (existing.state === "failed" && existing.failureCode !== null) {
          return {
            error: { code: processingFailureCode(existing.failureCode) },
            ok: false,
          };
        }
        return { error: { code: "upload_in_progress" }, ok: false };
      }

      const assetId = randomUUID();
      const objectNonce = randomUUID();
      const prefix = `materials/${validated.materialId}/assets/${assetId}/${objectNonce}`;
      const quarantineObjectKey = `${prefix}/quarantine`;
      try {
        await prisma.materialAsset.create({
          data: {
            declaredContentType: validated.declaredContentType,
            declaredSize: validated.declaredSize,
            expectedChecksum: validated.expectedChecksumSha256,
            id: assetId,
            idempotencyKey: validated.idempotencyKey,
            kind: validated.kind,
            materialId: validated.materialId,
            objectNonce,
            originalFilename: validated.filename,
            quarantineObjectKey,
            requestFingerprint: fingerprint,
            state: "pending",
            uploadedBy: validated.actor,
          },
        });
      } catch (error) {
        const raced = await prisma.materialAsset.findUnique({
          where: {
            materialId_uploadedBy_idempotencyKey: {
              idempotencyKey: validated.idempotencyKey,
              materialId: validated.materialId,
              uploadedBy: validated.actor,
            },
          },
          include: { materialAssetVariants: true },
        });
        if (raced === null) {
          throw error;
        }
        if (raced.requestFingerprint !== fingerprint) {
          return { error: { code: "idempotency_key_reused" }, ok: false };
        }
        return { error: { code: "upload_in_progress" }, ok: false };
      }

      const claimed = await prisma.materialAsset.updateMany({
        data: { state: "processing", updatedAt: new Date() },
        where: { id: assetId, state: "pending" },
      });
      if (claimed.count !== 1) {
        return { error: { code: "upload_in_progress" }, ok: false };
      }

      try {
        await putOrThrow(objectStorage, {
          body: validated.body,
          checksumSha256: validated.expectedChecksumSha256,
          contentType: validated.declaredContentType,
          key: quarantineObjectKey,
          namespace: "quarantine",
        });
        const processed = await processMaterialAssetBytes(validated);
        if (!processed.ok) {
          await prisma.materialAsset.update({
            data: {
              failureCode: processed.error.code,
              state: "failed",
              updatedAt: new Date(),
            },
            where: { id: assetId },
          });
          return processed;
        }

        if (processed.value.kind === "file") {
          const protectedObjectKey = `${prefix}/file`;
          const publicObjectKey = `${prefix}/public-file`;
          await prisma.materialAsset.update({
            data: { protectedObjectKey, publicObjectKey, updatedAt: new Date() },
            where: { id: assetId },
          });
          const object = {
            body: processed.value.body,
            checksumSha256: processed.value.checksumSha256,
            contentType: processed.value.contentType,
          };
          await Promise.all([
            putOrThrow(objectStorage, {
              ...object,
              key: protectedObjectKey,
              namespace: "protected",
            }),
            putOrThrow(objectStorage, {
              ...object,
              key: publicObjectKey,
              namespace: "public",
            }),
          ]);
          const ready = await prisma.materialAsset.update({
            data: {
              actualChecksum: processed.value.checksumSha256,
              actualContentType: processed.value.contentType,
              actualSize: processed.value.size,
              protectedObjectKey,
              publicObjectKey,
              readyAt: new Date(),
              state: "ready",
              updatedAt: new Date(),
            },
            where: { id: assetId },
            include: { materialAssetVariants: true },
          });
          await deleteQuarantineBestEffort(objectStorage, quarantineObjectKey);
          return { ok: true, value: toDto(ready) };
        }

        const image = processed.value;
        const protectedObjectKey = `${prefix}/original.webp`;
        const variants = image.variants.map((variant) => {
          const checksumSha256 = sha256(variant.body);
          return {
            body: variant.body,
            row: {
              assetId,
              byteSize: variant.body.byteLength,
              checksumSha256,
              contentType: variant.contentType,
              height: variant.height,
              protectedObjectKey: `${prefix}/image-${variant.width}.webp`,
              publicObjectKey: `${prefix}/public-image-${variant.width}.webp`,
              width: variant.width,
            },
          };
        });
        await prisma.$transaction(async (transaction) => {
          await transaction.materialAsset.update({
            data: { protectedObjectKey, updatedAt: new Date() },
            where: { id: assetId },
          });
          await transaction.materialAssetVariant.createMany({
            data: variants.map(({ row }) => row),
          });
        });
        await putOrThrow(objectStorage, {
          body: image.original.body,
          checksumSha256: sha256(image.original.body),
          contentType: image.original.contentType,
          key: protectedObjectKey,
          namespace: "protected",
        });
        await Promise.all(
          variants.map(async ({ body, row }) => {
            await Promise.all([
              putOrThrow(objectStorage, {
                body,
                checksumSha256: row.checksumSha256,
                contentType: row.contentType,
                key: row.protectedObjectKey,
                namespace: "protected",
              }),
              putOrThrow(objectStorage, {
                body,
                checksumSha256: row.checksumSha256,
                contentType: row.contentType,
                key: row.publicObjectKey,
                namespace: "public",
              }),
            ]);
          }),
        );
        const ready = await prisma.$transaction(async (transaction) => {
          return transaction.materialAsset.update({
            data: {
              actualChecksum: image.checksumSha256,
              actualContentType: image.contentType,
              actualSize: image.size,
              height: image.height,
              protectedObjectKey,
              readyAt: new Date(),
              state: "ready",
              updatedAt: new Date(),
              width: image.width,
            },
            where: { id: assetId },
            include: { materialAssetVariants: true },
          });
        });
        await deleteQuarantineBestEffort(objectStorage, quarantineObjectKey);
        return { ok: true, value: toDto(ready) };
      } catch {
        try {
          await prisma.materialAsset.updateMany({
            data: { failureCode: "storage_failure", state: "failed", updatedAt: new Date() },
            where: { id: assetId, state: "processing" },
          });
        } catch {
          // The transport-neutral failure below remains authoritative even if
          // the best-effort lifecycle marker cannot be persisted.
        }
        return { error: { code: "dependency_unavailable" }, ok: false };
      }
    },

    async inspectReferences(materialId, references) {
      return materialAssetQuery(async () => {
        const unique = uniqueReferences(references);
        if (unique.length === 0) return [];
        const assets = await prisma.materialAsset.findMany({
          where: { id: { in: unique.map((reference) => reference.assetId) } },
        });
        const byId = new Map(assets.map((asset) => [asset.id, asset]));
        return unique.flatMap((reference): readonly MaterialAssetReferenceIssue[] => {
          const asset = byId.get(reference.assetId);
          if (asset === undefined) return [{ assetId: reference.assetId, code: "asset_not_found" }];
          if (asset.materialId !== materialId) return [{ assetId: reference.assetId, code: "asset_wrong_material" }];
          if (asset.kind !== reference.kind) return [{ assetId: reference.assetId, code: "asset_kind_mismatch" }];
          if (asset.state !== "ready") return [{ assetId: reference.assetId, code: "asset_not_ready" }];
          return [];
        });
      });
    },

    async loadAccessFacts(assetIds) {
      return materialAssetQuery(async () => {
        if (assetIds.length === 0) return [];
        const rows = await prisma.materialAsset.findMany({
          where: { id: { in: [...new Set(assetIds)] }, state: "ready" },
          select: { id: true, kind: true, materialId: true },
        });
        return rows.flatMap((asset) =>
          asset.kind === "file" || asset.kind === "image"
            ? [{ assetId: asset.id, kind: asset.kind, materialId: asset.materialId }]
            : [],
        );
      });
    },

    async loadPresentations(materialId, assetIds) {
      return materialAssetQuery(async () => {
        if (assetIds.length === 0) return [];
        const rows = await prisma.materialAsset.findMany({
          where: {
            id: { in: [...new Set(assetIds)] },
            materialId,
            state: "ready",
          },
          include: { materialAssetVariants: true },
        });
        return rows.flatMap((asset): readonly MaterialAssetPresentation[] => {
          if (
            asset.kind === "image" &&
            asset.width !== null &&
            asset.height !== null
          ) {
            return [{
              assetId: asset.id,
              height: asset.height,
              kind: "image",
              variants: asset.materialAssetVariants
                .map(({ height, width }) => ({ height, width }))
                .toSorted((left, right) => left.width - right.width),
              width: asset.width,
            }];
          }
          if (
            asset.kind === "file" &&
            asset.actualContentType !== null &&
            asset.actualSize !== null
          ) {
            return [{
              assetId: asset.id,
              contentType: asset.actualContentType,
              filename: asset.originalFilename,
              kind: "file",
              size: asset.actualSize,
            }];
          }
          return [];
        });
      });
    },

    async loadDelivery(input) {
      return materialAssetQuery(async (): Promise<MaterialAssetDelivery | null> => {
        const asset = await prisma.materialAsset.findFirst({
          where: { id: input.assetId, materialId: input.materialId, state: "ready" },
        });
        if (
          asset === null ||
          asset.protectedObjectKey === null ||
          asset.actualContentType === null ||
          asset.actualSize === null
        ) {
          return null;
        }
        if (input.variantWidth !== undefined) {
          if (asset.kind !== "image") return null;
          const variant = await prisma.materialAssetVariant.findUnique({
            where: { assetId_width: { assetId: asset.id, width: input.variantWidth } },
          });
          if (variant === null) return null;
          return {
            assetId: asset.id,
            contentType: variant.contentType,
            filename: asset.originalFilename,
            kind: "image",
            materialId: asset.materialId,
            object: {
              protectedKey: variant.protectedObjectKey,
              publicKey: variant.publicObjectKey,
            },
            size: variant.byteSize,
          };
        }
        // Images are delivered only through a verified responsive variant. The
        // normalized protected original deliberately has no public locator and
        // its bytes differ from the uploaded source metadata retained here.
        if (asset.kind !== "file") return null;
        return {
          assetId: asset.id,
          contentType: asset.actualContentType,
          filename: asset.originalFilename,
          kind: "file",
          materialId: asset.materialId,
          object: {
            protectedKey: asset.protectedObjectKey,
            publicKey: asset.publicObjectKey,
          },
          size: asset.actualSize,
        };
      });
    },

    async cleanupOrphans(input) {
      return materialAssetQuery(async () => {
        const now = input.now ?? new Date();
        const cutoff = new Date(now.getTime() - input.graceMs);
        const candidates = await prisma.materialAsset.findMany({
          where: {
            orphanedAt: { lte: cutoff },
            updatedAt: { lte: cutoff },
          },
          orderBy: { orphanedAt: "asc" },
          select: { id: true },
          take: 100,
        });
        let cleaned = 0;
        let retained = 0;
        for (const candidate of candidates) {
          const claimed = await prisma.$transaction(async (transaction) => {
            const asset = await transaction.materialAsset.findUnique({
              where: { id: candidate.id },
              include: { materialAssetVariants: true },
            });
            if (
              asset === null ||
              asset.orphanedAt > cutoff ||
              asset.updatedAt > cutoff
            ) return null;
            await transaction.$executeRaw(Prisma.sql`
              select pg_advisory_xact_lock(hashtextextended(${asset.materialId}, 0))
            `);
            if (
              asset.state === "ready" &&
              await input.isReferenced({
                assetId: asset.id,
                materialId: asset.materialId,
              })
            ) {
              await transaction.materialAsset.update({
                data: { orphanedAt: now, updatedAt: now },
                where: { id: asset.id },
              });
              return { kind: "retained" as const };
            }
            const latest = await transaction.materialAsset.findUnique({
              where: { id: asset.id },
              include: { materialAssetVariants: true },
            });
            if (latest === null || latest.updatedAt > cutoff) return null;
            await transaction.materialAsset.update({
              data: {
                cleanupClaimedAt: now,
                failureCode: "cleanup_claimed",
                state: "failed",
                updatedAt: now,
              },
              where: { id: latest.id },
            });
            return { kind: "claimed" as const, asset: latest };
          });
          if (claimed?.kind === "retained") {
            retained += 1;
            continue;
          }
          if (claimed?.kind !== "claimed") continue;
          const objects = [
            {
              namespace: "quarantine" as const,
              key: claimed.asset.quarantineObjectKey,
            },
            ...(claimed.asset.protectedObjectKey === null
              ? []
              : [{
                  namespace: "protected" as const,
                  key: claimed.asset.protectedObjectKey,
                }]),
            ...(claimed.asset.publicObjectKey === null
              ? []
              : [{
                  namespace: "public" as const,
                  key: claimed.asset.publicObjectKey,
                }]),
            ...claimed.asset.materialAssetVariants.flatMap((variant) => [
              { namespace: "protected" as const, key: variant.protectedObjectKey },
              { namespace: "public" as const, key: variant.publicObjectKey },
            ]),
          ];
          try {
            for (const object of objects) {
              await objectStorage.delete(object.namespace, object.key);
            }
            await prisma.materialAsset.delete({ where: { id: claimed.asset.id } });
            cleaned += 1;
          } catch {
            retained += 1;
          }
        }
        return { cleaned, retained };
      });
    },
  };
  return Object.freeze(assets);
}

function validateUpload(input: Parameters<MaterialAssets["upload"]>[0]) {
  const filename = sanitizeFilename(input.filename);
  if (
    !uuidSchema.safeParse(input.actor).success || !uuidSchema.safeParse(input.materialId).success ||
    !sha256Schema.safeParse(input.expectedChecksumSha256.toLowerCase()).success ||
    input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128 ||
    input.declaredContentType.length < 1 || input.declaredContentType.length > 255 ||
    !Number.isInteger(input.declaredSize) || input.declaredSize < 1 ||
    filename === null
  ) return null;
  return { ...input, expectedChecksumSha256: input.expectedChecksumSha256.toLowerCase(), filename };
}

async function materialAssetQuery<Value>(
  operation: () => Promise<Value>,
): Promise<MaterialAssetQueryResult<Value>> {
  try {
    return { ok: true, value: await operation() };
  } catch {
    return {
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    };
  }
}

function sanitizeFilename(value: string): string | null {
  const safe = [...basename(value)]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  if (safe.length === 0) return null;
  return [...safe].slice(0, 255).join("");
}

function fingerprintUpload(input: NonNullable<ReturnType<typeof validateUpload>>) {
  return sha256(new TextEncoder().encode(JSON.stringify({
    checksum: input.expectedChecksumSha256,
    contentType: input.declaredContentType,
    filename: input.filename,
    kind: input.kind,
    size: input.declaredSize,
  })));
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

async function putOrThrow(storage: ObjectStorage, input: Parameters<ObjectStorage["putImmutable"]>[0]): Promise<void> {
  const result = await storage.putImmutable(input);
  if (!result.ok) throw new Error("Immutable object key collision");
}

async function deleteQuarantineBestEffort(storage: ObjectStorage, key: string): Promise<void> {
  try { await storage.delete("quarantine", key); } catch { /* cleanup retries stale quarantine */ }
}

function uniqueReferences(references: readonly MaterialAssetReference[]): readonly MaterialAssetReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.kind}:${reference.assetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function processingFailureCode(code: string): Extract<UploadMaterialAssetResult, { ok: false }>["error"]["code"] {
  switch (code) {
    case "checksum_mismatch":
    case "executable_content":
    case "image_decode_failed":
    case "image_too_large":
    case "mime_mismatch":
    case "size_mismatch":
    case "unsupported_image_type": return code;
    case "storage_failure": return "dependency_unavailable";
    default: return "invalid_upload";
  }
}

function toDto(asset: {
  readonly actualContentType: string | null;
  readonly actualSize: number | null;
  readonly height: number | null;
  readonly id: string;
  readonly kind: string;
  readonly originalFilename: string;
  readonly materialAssetVariants: readonly { readonly height: number; readonly width: number }[];
  readonly width: number | null;
}): MaterialAssetDto {
  if (asset.actualContentType === null || asset.actualSize === null || (asset.kind !== "file" && asset.kind !== "image")) {
    throw new TypeError("Ready MaterialAsset persistence is incomplete");
  }
  return {
    assetId: asset.id,
    contentType: asset.actualContentType,
    filename: asset.originalFilename,
    ...(asset.height === null ? {} : { height: asset.height }),
    kind: asset.kind,
    size: asset.actualSize,
    state: "ready",
    ...(asset.kind === "image" ? { variants: asset.materialAssetVariants.map(({ height, width }) => ({ height, width })).toSorted((a, b) => a.width - b.width) } : {}),
    ...(asset.width === null ? {} : { width: asset.width }),
  };
}
