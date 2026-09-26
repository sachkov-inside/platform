import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { MaterialMetadataSelection } from "../../domain/material-metadata.js";
import {
  validateSourceBodySchema,
  type ValidateSourceOperation,
} from "./import-source-material.contract.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  accountId,
  idempotencyKeySchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { assembleCreateDraft } from "../create-draft/create-draft.js";
import { assembleSaveMaterial } from "../save-material/save-material.js";
import {
  reserveSourceBodySchema,
  applySourceBodySchema,
  type ApplySourceOperation,
  type ReserveSourceOperation,
} from "./import-source-material.contract.js";

const reserveCommand = reserveSourceBodySchema.extend({ actor: accountId });
const applyCommand = applySourceBodySchema.extend({
  actor: accountId,
  idempotencyKey: idempotencyKeySchema,
});
const receiptSchema = z.object({
  id: z.uuid(),
  contentVersion: z.coerce.number().int().positive(),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  publishedAt: z.date().nullable(),
});

export function assembleReserveSourceMaterial(
  dependencies: MaterialAuthoringDependencies,
): ReserveSourceOperation {
  return async (input) => {
    const parsed = parseCommand(reserveCommand, input);
    if (!parsed.ok) return parsed;
    const { actor, source } = parsed.value;
    const authorized = await authorizeManager(dependencies.authorPolicy, actor);
    if (!authorized.ok) return authorized;
    async function existing() {
      const row = await dependencies.prisma.material.findUnique({
        where: { sourceId: source.id },
      });
      if (row === null) return null;
      const current = receiptSchema.parse(row);
      return {
        ok: true as const,
        value: {
          materialId: current.id,
          contentVersion: current.contentVersion,
          publicationState: current.publicationState,
          publishedAt: current.publishedAt?.toISOString() ?? null,
        },
      };
    }
    try {
      const found = await existing();
      if (found !== null) return found;
      const created = await assembleCreateDraft(
        dependencies,
        source,
      )({
        actor,
        idempotencyKey: `source:${createHash("sha256").update(source.id).digest("hex")}`,
        metadata: {
          title: null,
          summary: null,
          access: "free",
          difficulty: null,
          outcomes: [],
          topicId: null,
          formatId: null,
          tagIds: [],
          seriesIds: [],
        },
        body: {
          schemaVersion: 1,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
        },
      });
      // Another authorized importer may have reserved the same source concurrently.
      return created.ok ? created : ((await existing()) ?? created);
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "reserveSourceMaterial" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

export function assembleApplySourceMaterial(
  dependencies: MaterialAuthoringDependencies,
): ApplySourceOperation {
  return async (input) => {
    const parsed = parseCommand(applyCommand, input);
    if (!parsed.ok) return parsed;
    const { source, videoChapters, ...command } = parsed.value;
    if (
      command.publicationState === "published" &&
      source.showInFeed &&
      command.metadata.seriesIds.length === 0 &&
      command.metadata.access !== "free"
    ) {
      return {
        ok: false,
        error: {
          code: "invalid_reference",
          issues: [
            {
              code: "standalone_feed_material_must_be_free",
              path: "/metadata/access",
            },
          ],
        },
      };
    }
    return assembleSaveMaterial(
      dependencies,
      source,
    )({
      ...command,
      ...(videoChapters === undefined ? {} : { videoChapters }),
    });
  };
}

export function assembleValidateSourceContent(
  dependencies: MaterialAuthoringDependencies,
): ValidateSourceOperation {
  return async (input) => {
    const parsed = parseCommand(
      validateSourceBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorized.ok) return authorized;
    const selection = MaterialMetadataSelection.create(command.metadata);
    if (!selection.ok) return selection;
    const body = dependencies.materialBodyOperations.accept(command.body, {
      assignMissingNodeIds: true,
    });
    if (!body.ok) return body;
    if (command.publicationState === "published") {
      const metadata = selection.value.materialize(
        command.metadata.seriesIds.map((seriesId, index) => ({
          seriesId,
          ordinal: index + 1,
        })),
        "import-preview",
      );
      const publishable = metadata.validateForPublication();
      if (!publishable.ok) return publishable;
    }
    return { ok: true, value: { valid: true } };
  };
}
