import { z } from "zod";

import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations, MaterialBodySnapshot } from "../../domain/material-body/material-body.js";
import {
  materialId,
  type MaterialId,
} from "../../domain/material-identifiers.js";
import type { MaterialAccess } from "../../domain/material-metadata.js";
import type { PublicationState } from "../../domain/material.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { loadPublishedBodyAtVersion } from "../../infrastructure/postgres/current-material.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { Result } from "../../result.js";
import type { SystemError } from "../material-authoring/material-authoring.contract.js";

export interface MaterialAccessFacts {
  readonly materialId: MaterialId;
  readonly publicationState: PublicationState;
  readonly access: MaterialAccess;
  readonly contentVersion: number;
  readonly primaryVideoId: string | null;
}

type MaterialContentError =
  | { readonly code: "invalid_request_shape" }
  | SystemError;

export interface MaterialContent {
  findAccessFacts(
    materialId: MaterialId,
  ): Promise<Result<MaterialAccessFacts | null, MaterialContentError>>;
  findAccessFactsMany(
    materialIds: readonly MaterialId[],
  ): Promise<Result<readonly MaterialAccessFacts[], MaterialContentError>>;
  loadPublishedBody(query: {
    readonly materialId: MaterialId;
    readonly checkedContentVersion: number;
  }): Promise<Result<MaterialBodySnapshot | null, MaterialContentError>>;
  containsAssetReference(input: {
    readonly assetId: string;
    readonly checkedContentVersion?: number;
    readonly materialId: string;
  }): Promise<Result<boolean, MaterialContentError>>;
  containsVideoReference(input: {
    readonly materialId: string;
    readonly videoId: string;
  }): Promise<Result<boolean, MaterialContentError>>;
}

export const MATERIAL_CONTENT = Symbol("MATERIAL_CONTENT");

const accessFactsRowSchema = z.object({
  id: z.uuid(),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  access: z.enum(["free", "membership", "workshop"]),
  contentVersion: z.bigint(),
  primaryVideoId: z.uuid().nullable(),
});
const loadBodyQuerySchema = z
  .object({
    materialId: normalizedUuidSchema,
    checkedContentVersion: z.number().int().positive(),
  })
  .strict();
const materialIdsSchema = z.array(normalizedUuidSchema).min(1).max(100);
const assetReferenceQuerySchema = z
  .object({
    assetId: z.uuid(),
    checkedContentVersion: z.number().int().positive().optional(),
    materialId: z.uuid(),
  })
  .strict();
const videoReferenceQuerySchema = z.object({
  materialId: z.uuid(),
  videoId: z.uuid(),
}).strict();

export function assembleMaterialContent(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
}): MaterialContent {
  return Object.freeze({
    async findAccessFacts(
      materialIdValue: MaterialId,
    ): Promise<Result<MaterialAccessFacts | null, MaterialContentError>> {
      const parsed = normalizedUuidSchema.safeParse(materialIdValue);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      try {
        const row = await dependencies.prisma.material.findUnique({
          where: { id: parsed.data },
          select: {
            id: true,
            publicationState: true,
            access: true,
            contentVersion: true,
            primaryVideoId: true,
          },
        });
        if (row === null) {
          return { ok: true, value: null };
        }
        const facts = toAccessFacts(row);
        if (facts === undefined) {
          return {
            ok: false,
            error: mapPostgresReadError(new TypeError("invalid Material facts")),
          };
        }
        return { ok: true, value: facts };
      } catch (error) {
        return { ok: false, error: mapPostgresReadError(error) };
      }
    },

    async findAccessFactsMany(
      materialIdValues: readonly MaterialId[],
    ): Promise<Result<readonly MaterialAccessFacts[], MaterialContentError>> {
      const parsed = materialIdsSchema.safeParse(materialIdValues);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      try {
        const checkedMaterialIds = [...new Set(parsed.data)].map(materialId);
        const rows = await dependencies.prisma.material.findMany({
          where: { id: { in: checkedMaterialIds } },
          select: {
            id: true,
            publicationState: true,
            access: true,
            contentVersion: true,
            primaryVideoId: true,
          },
        });
        const facts = rows.map(toAccessFacts);
        if (facts.some((item) => item === undefined)) {
          return {
            ok: false,
            error: mapPostgresReadError(new TypeError("invalid Material facts")),
          };
        }
        return {
          ok: true,
          value: facts.filter(
            (item): item is MaterialAccessFacts => item !== undefined,
          ),
        };
      } catch (error) {
        return { ok: false, error: mapPostgresReadError(error) };
      }
    },

    async loadPublishedBody(input: {
      readonly materialId: MaterialId;
      readonly checkedContentVersion: number;
    }): Promise<Result<MaterialBodySnapshot | null, MaterialContentError>> {
      const parsed = loadBodyQuerySchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      try {
        const body = await loadPublishedBodyAtVersion(
          dependencies.prisma,
          dependencies.materialBodyOperations,
          materialId(parsed.data.materialId),
          parsed.data.checkedContentVersion,
        );
        return { ok: true, value: body ?? null };
      } catch (error) {
        return { ok: false, error: mapPostgresReadError(error) };
      }
    },

    async containsAssetReference(input: {
      readonly assetId: string;
      readonly checkedContentVersion?: number;
      readonly materialId: string;
    }): Promise<Result<boolean, MaterialContentError>> {
      const parsed = assetReferenceQuerySchema.safeParse(input);
      if (!parsed.success) {
        return { error: { code: "invalid_request_shape" }, ok: false };
      }
      try {
        const row = await dependencies.prisma.material.findUnique({
          where: { id: parsed.data.materialId },
          select: { body: true, contentVersion: true, schemaVersion: true },
        });
        if (
          row === null ||
          (parsed.data.checkedContentVersion !== undefined &&
            row.contentVersion !== BigInt(parsed.data.checkedContentVersion))
        ) {
          return { ok: true, value: false };
        }
        const body = dependencies.materialBodyOperations.accept({
          doc: row.body,
          schemaVersion: row.schemaVersion,
        });
        if (!body.ok) {
          return {
            error: mapPostgresReadError(new TypeError("Stored Material body is invalid")),
            ok: false,
          };
        }
        const extraction = dependencies.materialBodyOperations.extract(body.value);
        if (!extraction.ok) {
          return {
            error: mapPostgresReadError(
              new TypeError("Stored Material body cannot be inspected"),
            ),
            ok: false,
          };
        }
        return {
          ok: true,
          value: extraction.value.resources.some(
            (resource) => resource.assetId === parsed.data.assetId,
          ),
        };
      } catch (error) {
        return { error: mapPostgresReadError(error), ok: false };
      }
    },

    async containsVideoReference(input: {
      readonly materialId: string;
      readonly videoId: string;
    }): Promise<Result<boolean, MaterialContentError>> {
      const parsed = videoReferenceQuerySchema.safeParse(input);
      if (!parsed.success) {
        return { error: { code: "invalid_request_shape" }, ok: false };
      }
      try {
        const [current, published] = await Promise.all([
          dependencies.prisma.material.findFirst({
            where: {
              id: parsed.data.materialId,
              primaryVideoId: parsed.data.videoId,
            },
            select: { id: true },
          }),
          dependencies.prisma.publishedMaterial.findFirst({
            where: {
              materialId: parsed.data.materialId,
              primaryVideoId: parsed.data.videoId,
            },
            select: { materialId: true },
          }),
        ]);
        return { ok: true, value: current !== null || published !== null };
      } catch (error) {
        return { error: mapPostgresReadError(error), ok: false };
      }
    },
  });
}

function toAccessFacts(row: unknown): MaterialAccessFacts | undefined {
  const parsed = accessFactsRowSchema.safeParse(row);
  const contentVersion = parsed.success
    ? Number(parsed.data.contentVersion)
    : Number.NaN;
  if (!parsed.success || !Number.isSafeInteger(contentVersion)) {
    return undefined;
  }
  return {
    materialId: materialId(parsed.data.id),
    publicationState: parsed.data.publicationState,
    access: parsed.data.access,
    contentVersion,
    primaryVideoId: parsed.data.primaryVideoId,
  };
}
