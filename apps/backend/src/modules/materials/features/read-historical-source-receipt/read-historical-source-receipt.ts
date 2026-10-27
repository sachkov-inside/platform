import { z } from "zod";
import { historicalAuthoringSourceV1Schema } from "../../../../infrastructure/content-authoring/authoring-source.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { materialMetadataSelectionWireSchema } from "../../adapters/material-authoring-wire.js";
import { MaterialMetadataSelection } from "../../domain/material-metadata.js";
import { applySourceBodySchema } from "../import-source-material/import-source-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";

/** Original v1 request bytes are interpreted only for a stored, actor-bound receipt lookup. */
export const historicalSourceMaterialRequestSchema = applySourceBodySchema
  .extend({
    source: historicalAuthoringSourceV1Schema,
    metadata: materialMetadataSelectionWireSchema
      .omit({ productIds: true })
      .extend({
        seriesIds: z.array(z.uuid()).max(100),
        access: z.enum(["free", "closed", "membership"]),
      })
      .strict(),
  })
  .strict();
const commandSchema = historicalSourceMaterialRequestSchema
  .extend({
    actor: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export function assembleReadHistoricalSourceMaterialReceipt(
  dependencies: MaterialAuthoringDependencies,
) {
  return async (input: z.infer<typeof commandSchema>) => {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } } as const;
    const command = parsed.data;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return authorization;
    const { seriesIds, ...metadata } = command.metadata;
    const selection = MaterialMetadataSelection.create({
      ...metadata,
      access: metadata.access === "membership" ? "closed" : metadata.access,
      productIds: seriesIds,
    });
    if (!selection.ok) return selection;
    const body = dependencies.materialBodyOperations.accept(command.body, {
      assignMissingNodeIds: false,
    });
    if (!body.ok) return body;
    const { productIds, ...normalizedMetadata } = selection.value.toValues();
    const fingerprint = fingerprintCommand({
      operation: "save_material",
      source: command.source,
      materialId: command.materialId,
      expectedContentVersion: command.expectedContentVersion,
      publicationState: command.publicationState,
      ...(command.notifyTelegram === undefined
        ? {}
        : { notifyTelegram: command.notifyTelegram }),
      metadata: { ...normalizedMetadata, seriesIds: productIds },
      body: body.value,
      primaryVideoId: command.primaryVideoId,
      deleteVideoId: null,
      videoChapters: command.videoChapters ?? null,
      confirmedProductRemovals: [],
    });
    try {
      const row = await dependencies.prisma.authoringIdempotency.findUnique({
        where: {
          actorId_operation_idempotencyKey: {
            actorId: command.actor,
            operation: "save_material",
            idempotencyKey: command.idempotencyKey,
          },
        },
      });
      if (row === null)
        return {
          ok: false,
          error: { code: "historical_receipt_not_found" },
        } as const;
      if (row.requestFingerprint !== fingerprint)
        return { ok: false, error: { code: "idempotency_conflict" } } as const;
      if (
        row.materialId === null ||
        row.contentVersion === null ||
        row.publicationState === null ||
        row.deleted
      )
        return {
          ok: false,
          error: { code: "historical_receipt_unavailable" },
        } as const;
      return {
        ok: true,
        value: {
          materialId: row.materialId,
          contentVersion: Number(row.contentVersion),
          publicationState: row.publicationState,
          publishedAt: row.publishedAt?.toISOString() ?? null,
        },
      } as const;
    } catch (error) {
      return dependencyFailure(
        {
          module: "materials",
          operation: "readHistoricalSourceMaterialReceipt",
        },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  };
}
export type ReadHistoricalSourceMaterialReceipt = ReturnType<
  typeof assembleReadHistoricalSourceMaterialReceipt
>;
