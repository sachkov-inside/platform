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
}

export const MATERIAL_CONTENT = Symbol("MATERIAL_CONTENT");

const accessFactsRowSchema = z.object({
  id: z.uuid(),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  access: z.enum(["free", "membership"]),
  contentVersion: z.bigint(),
});
const loadBodyQuerySchema = z
  .object({
    materialId: normalizedUuidSchema,
    checkedContentVersion: z.number().int().positive(),
  })
  .strict();
const materialIdsSchema = z.array(normalizedUuidSchema).min(1).max(100);

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
  };
}
