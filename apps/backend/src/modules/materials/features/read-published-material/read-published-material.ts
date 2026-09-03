import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { MaterialAssets } from "../../../assets/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import { materialId } from "../../domain/material-identifiers.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import type { MaterialContent } from "../../facets/material-content/material-content.js";
import { selectPublishedMaterialProjectionBySlug } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  PublishedMaterialReadResult,
  ReadPublishedMaterialQuery,
} from "./read-published-material.contract.js";
import { hydrateMaterialAssets } from "../../domain/material-body/hydrate-material-assets.js";
import type { Videos } from "../../../videos/index.js";

const querySchema = z
  .object({
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("anonymous") }).strict(),
      z
        .object({
          kind: z.literal("account"),
          accountId: normalizedUuidSchema,
        })
        .strict(),
    ]),
    slug: z
      .string()
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();
const MAX_READ_ATTEMPTS = 2;

export async function readPublishedMaterial(
  dependencies: {
    readonly prisma: MaterialsPrismaClient;
    readonly contentAccess: ContentAccess;
    readonly materialContent: MaterialContent;
    readonly materialBodyOperations: MaterialBodyOperations;
    readonly membershipAcquisitionUrl: string;
    readonly materialAssets?: Pick<MaterialAssets, "loadPresentations">;
    readonly videos?: Pick<Videos, "loadPresentation">;
  },
  query: ReadPublishedMaterialQuery,
): Promise<PublishedMaterialReadResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  const { slug } = parsed.data;
  const { subject } = query;
  const correlationId = randomUUID();
  try {
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
      const projection = await selectPublishedMaterialProjectionBySlug(
        dependencies.prisma,
        slug,
      );
      if (projection === undefined) {
        return { ok: false, error: { code: "material_not_found" } };
      }
      const resourceId = materialId(projection.materialId);

      const access = await dependencies.contentAccess.authorize({
        subject,
        action: "read",
        resource: {
          kind: "material",
          materialId: resourceId,
        },
        enforcementPoint: "published_material_read",
        correlationId,
      });
      if (access.effect === "deny") {
        if (
          projection.access === "workshop" ||
          access.reason === "resource_not_found" ||
          access.reason === "resource_unpublished"
        ) {
          return { ok: false, error: { code: "material_not_found" } };
        }
        return {
          ok: true,
          value: {
            kind: "teaser",
            cacheScope: "private-no-store",
            projection,
            access: {
              availability: "locked",
              cta: {
                label: "Получить доступ",
                url: dependencies.membershipAcquisitionUrl,
              },
            },
          },
        };
      }
      if (access.checkedContentVersion !== projection.contentVersion) {
        continue;
      }

      const body = await dependencies.materialContent.loadPublishedBody({
        materialId: resourceId,
        checkedContentVersion: access.checkedContentVersion,
      });
      if (!body.ok) {
        return body.error.code === "invalid_request_shape"
          ? internalError()
          : { ok: false, error: body.error };
      }
      if (body.value === null) {
        continue;
      }
      const rendered = dependencies.materialBodyOperations.render(body.value);
      if (!rendered.ok) {
        return internalError();
      }
      const extraction = dependencies.materialBodyOperations.extract(body.value);
      if (!extraction.ok) return internalError();
      const loadedPresentations = dependencies.materialAssets === undefined
        ? { ok: true as const, value: [] }
        : await dependencies.materialAssets.loadPresentations(
            projection.materialId,
            extraction.value.resources.map((resource) => resource.assetId),
          );
      if (!loadedPresentations.ok) return loadedPresentations;
      let loadedVideo;
      if (projection.primaryVideoId === null) {
        loadedVideo = { ok: true as const, value: null };
      } else {
        if (dependencies.videos === undefined) {
          return { ok: false, error: { code: "dependency_unavailable", retryable: true } };
        }
        loadedVideo = await dependencies.videos.loadPresentation({
          materialId: projection.materialId,
          videoId: projection.primaryVideoId,
        });
      }
      if (!loadedVideo.ok) {
        return loadedVideo.error.code === "dependency_unavailable"
          ? { ok: false, error: loadedVideo.error }
          : internalError();
      }
      return {
        ok: true,
        value: {
          kind: "available",
          cacheScope:
            access.reason === "public_resource" ? "public" : "private-no-store",
          projection,
          body: hydrateMaterialAssets(rendered.value, loadedPresentations.value),
          primaryVideo: loadedVideo.value,
        },
      };
    }
    return internalError();
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}

function internalError(): PublishedMaterialReadResult {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
