import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PreviewRevisionOperation } from "./preview-revision.contract.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { ContentAccess } from "../../ports/content-access.js";
import { failure } from "../../shared/application-result.js";
import { toMaterialRevisionDto } from "../../shared/material-revision-dto.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import {
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  accountId,
} from "../../shared/command-validation.js";
import {
  loadCurrentRevisionId,
  loadMaterialRevisionHeader,
} from "../../infrastructure/postgres/material-lookups.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-revision-reader.js";

const previewRevisionQuery = z
  .object({
    actor: accountId,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly contentAccess: ContentAccess;
}

export function assemblePreviewRevision(
  dependencies: Dependencies,
): PreviewRevisionOperation {
  return async (input) => {
    const parsed = parseCommand(previewRevisionQuery, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const query = parsed.value;
    try {
      const header = await loadMaterialRevisionHeader(
        dependencies.prisma,
        query.materialId,
        query.revisionId,
      );
      if (header === undefined) {
        const currentRevisionId = await loadCurrentRevisionId(
          dependencies.prisma,
          query.materialId,
        );
        return failure({
          code: currentRevisionId === undefined ? "material_not_found" : "revision_not_found",
        });
      }
      const subject = { kind: "account", accountId: query.actor } as const;
      const decision = await dependencies.contentAccess.authorize({
        subject,
        action: "preview",
        resource: {
          kind: "material_body",
          materialId: query.materialId,
          revisionId: query.revisionId,
          publication: "draft",
          access: header.access,
        },
      });
      await dependencies.prisma.materialAccessAuditEvent.create({
        data: {
          id: randomUUID(),
          materialId: query.materialId,
          revisionId: query.revisionId,
          actorId: subject.accountId,
          action: "preview",
          decision: decision.allowed ? "allow" : "deny",
        },
      });
      if (!decision.allowed) {
        return failure(
          decision.reason === "temporarily_unavailable"
            ? { code: "dependency_unavailable", retryable: true }
            : { code: "forbidden" },
        );
      }
      const revision = await loadMaterialRevision(
        dependencies.prisma,
        dependencies.materialBodyOperations,
        query.materialId,
        query.revisionId,
      );
      if (revision === undefined || !revision.ok) {
        return failure({ code: "internal_error", correlationId: randomUUID() });
      }
      const rendered = dependencies.materialBodyOperations.render(revision.value.body);
      if (!rendered.ok) {
        return failure(rendered.error);
      }
      return {
        ok: true,
        value: {
          materialId: revision.value.materialId,
          revisionId: revision.value.id,
          metadata: toMaterialRevisionDto(revision.value).metadata,
          cacheScope: "private-no-store",
          body: rendered.value,
        },
      };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}
