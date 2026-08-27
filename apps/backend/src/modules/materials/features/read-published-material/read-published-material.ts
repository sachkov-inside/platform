import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import {
  materialId,
} from "../../domain/material-identifiers.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { loadPublishedBodyAtVersion } from "../../infrastructure/postgres/current-material.js";
import { selectPublishedMaterialProjectionBySlug } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import type { ContentAccess } from "../../ports/content-access.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  PublishedMaterialReadResult,
  ReadPublishedMaterialQuery,
} from "./read-published-material.contract.js";

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

export async function readPublishedMaterial(
  dependencies: {
    readonly prisma: MaterialsPrisma;
    readonly contentAccess: ContentAccess;
    readonly materialBodyOperations: MaterialBodyOperations;
  },
  query: ReadPublishedMaterialQuery,
): Promise<PublishedMaterialReadResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  const { subject, slug } = parsed.data;
  try {
    const projection = await selectPublishedMaterialProjectionBySlug(
      dependencies.prisma,
      slug,
    );
    if (projection === undefined) {
      return { ok: false, error: { code: "material_not_found" } };
    }

    let access;
    try {
      access = await dependencies.contentAccess.authorize({
        subject,
        action: "read",
        resource: {
          kind: "material_body",
          materialId: projection.materialId,
          contentVersion: projection.contentVersion,
          publication: "published",
          access: projection.access,
        },
      });
    } catch {
      access = {
        allowed: false as const,
        reason: "temporarily_unavailable" as const,
      };
    }

    if (projection.access === "membership") {
      await dependencies.prisma.materialAccessAuditEvent.create({
        data: {
          id: randomUUID(),
          materialId: materialId(projection.materialId),
          contentVersion: BigInt(projection.contentVersion),
          actorId:
            subject.kind === "account" ? subject.accountId : null,
          action: "read",
          decision: access.allowed ? "allow" : "deny",
        },
      });
    }
    if (!access.allowed) {
      return {
        ok: true,
        value: {
          kind: "teaser",
          cacheScope:
            subject.kind === "anonymous" ? "public" : "private-no-store",
          projection,
          access,
        },
      };
    }

    const body = await loadPublishedBodyAtVersion(
      dependencies.prisma,
      dependencies.materialBodyOperations,
      materialId(projection.materialId),
      projection.contentVersion,
    );
    if (body === undefined) {
      return internalError();
    }
    const rendered = dependencies.materialBodyOperations.render(body);
    if (!rendered.ok) {
      return internalError();
    }
    return {
      ok: true,
      value: {
        kind: "available",
        cacheScope: access.reason === "public" ? "public" : "private-no-store",
        projection,
        body: rendered.value,
      },
    };
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
