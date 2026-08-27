import { z } from "zod";

import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations, MaterialBodySnapshot } from "../../domain/material-body/material-body.js";
import { materialId } from "../../domain/material-identifiers.js";
import type { MaterialAccess } from "../../domain/material-metadata.js";
import type { PublicationState } from "../../domain/material.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { loadPublishedBodyAtVersion } from "../../infrastructure/postgres/current-material.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { Result } from "../../result.js";
import type { SystemError } from "../material-authoring/material-authoring.contract.js";

export interface MaterialAccessFacts {
  readonly materialId: string;
  readonly publicationState: PublicationState;
  readonly access: MaterialAccess;
  readonly contentVersion: number;
}

type MaterialContentError =
  | { readonly code: "invalid_request_shape" }
  | SystemError;

export interface MaterialContent {
  findAccessFacts(
    materialId: string,
  ): Promise<Result<MaterialAccessFacts | null, MaterialContentError>>;
  loadPublishedBody(query: {
    readonly materialId: string;
    readonly checkedContentVersion: number;
  }): Promise<Result<MaterialBodySnapshot | null, MaterialContentError>>;
}

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

export function assembleMaterialContent(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
}): MaterialContent {
  return Object.freeze({
    async findAccessFacts(
      materialIdValue: string,
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
        const facts = accessFactsRowSchema.safeParse(row);
        const contentVersion = facts.success
          ? Number(facts.data.contentVersion)
          : Number.NaN;
        if (!facts.success || !Number.isSafeInteger(contentVersion)) {
          return {
            ok: false,
            error: mapPostgresReadError(new TypeError("invalid Material facts")),
          };
        }
        return {
          ok: true,
          value: {
            materialId: facts.data.id,
            publicationState: facts.data.publicationState,
            access: facts.data.access,
            contentVersion,
          },
        };
      } catch (error) {
        return { ok: false, error: mapPostgresReadError(error) };
      }
    },

    async loadPublishedBody(input: {
      readonly materialId: string;
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
