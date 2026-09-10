import {
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  guideChapterAssignmentsSchema,
  guideChapterDraftsSchema,
} from "../../shared/guide-chapters.js";
import { seriesStepGroupsSchema } from "../../shared/series-step-groups.js";

import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import {
  contentVersionWireSchema,
  idempotencyKeyWireSchema,
  materialBodySnapshotWireSchema,
  materialIdWireSchema,
  materialMetadataSelectionWireSchema,
  publicationStateWireSchema,
} from "../material-authoring-wire.js";

const applicationResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.json() }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.looseObject({ code: z.string() }),
    })
    .strict(),
]);

const collectionKindSchema = z.enum(["guide", "series", "topic"]);
const guideIntroductionSchema = z
  .object({
    audience: z.string(),
    outcome: z.string(),
    prerequisites: z.string(),
    scope: z.string(),
  })
  .strict();
const collectionIdSchema = z.uuid();
const collectionVersionSchema = z.number().int().positive();
const seriesOrderVersionSchema = z.string().regex(/^[a-f0-9]{64}$/u);

type AuthoringResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: { readonly code: string };
    };

export function assembleMaterialAuthoringMcpServer(dependencies: {
  readonly accountId: string;
  readonly authoring: MaterialAuthoring;
}): McpServer {
  const server = new McpServer(
    { name: "inside-platform-material-authoring", version: "1.0.0" },
    {
      instructions:
        "Guide is the standalone product, distinct from the Material format guide. Legacy series fields and playlist tools are compatibility aliases. Manage Topics, Guides, Guide composition, and the complete current Material through the same Platform application rules. " +
        "Save may publish, unpublish, replace live content, or change access immediately. " +
        "Always reload after stale content, collection, or Guide order errors; successful Saves have no server-side Undo or history.",
    },
  );

  server.registerTool(
    "material_create_draft",
    {
      title: "Create Material draft",
      description:
        "Create one never-published Material through Platform authoring rules. Reuse the same idempotency key when retrying an uncertain request.",
      inputSchema: z
        .object({
          idempotencyKey: idempotencyKeyWireSchema,
          metadata: materialMetadataSelectionWireSchema,
          body: materialBodySnapshotWireSchema,
        })
        .strict(),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ idempotencyKey: key, metadata, body }) =>
      toToolResult(
        dependencies.authoring.createDraft({
          actor: dependencies.accountId,
          idempotencyKey: key,
          metadata,
          body,
        }),
      ),
  );

  server.registerTool(
    "material_load",
    {
      title: "Load current Material",
      description:
        "Load the complete current saved Material state and contentVersion through Platform authoring authorization.",
      inputSchema: z.object({ materialId: materialIdWireSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ materialId }) =>
      toToolResult(
        dependencies.authoring.loadMaterial({
          actor: dependencies.accountId,
          materialId,
        }),
      ),
  );

  server.registerTool(
    "material_save",
    {
      title: "Save complete Material state",
      description:
        "Pass primaryVideoId from material_load to preserve the video, or explicitly null to detach without deleting its source. Atomically replace content, metadata, relations, access, and publication state. This may change live content immediately and has no server-side Undo or history.",
      inputSchema: z
        .object({
          idempotencyKey: idempotencyKeyWireSchema,
          materialId: materialIdWireSchema,
          expectedContentVersion: contentVersionWireSchema,
          primaryVideoId: z.uuid().nullable(),
          publicationState: publicationStateWireSchema,
          metadata: materialMetadataSelectionWireSchema,
          body: materialBodySnapshotWireSchema,
        })
        .strict(),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      idempotencyKey: key,
      materialId,
      expectedContentVersion,
      primaryVideoId,
      publicationState: targetState,
      metadata,
      body,
    }) =>
      toToolResult(
        dependencies.authoring.saveMaterial({
          actor: dependencies.accountId,
          idempotencyKey: key,
          materialId,
          expectedContentVersion,
          primaryVideoId,
          publicationState: targetState,
          metadata,
          body,
        }),
      ),
  );

  server.registerTool(
    "material_preview",
    {
      title: "Preview current Material",
      description:
        "Render the current saved Material through canonical ContentAccess and the same safe renderer used by Platform.",
      inputSchema: z.object({ materialId: materialIdWireSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ materialId }) =>
      toToolResult(
        dependencies.authoring.previewMaterial({
          actor: dependencies.accountId,
          materialId,
        }),
      ),
  );

  server.registerTool(
    "content_collection_list",
    {
      title: "List Topics or Guides",
      description:
        "List all active and archived Topics or Guides with optimistic versions and Material counts.",
      inputSchema: z.object({ kind: collectionKindSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ kind }) =>
      toToolResult(
        dependencies.authoring.listContentCollections({
          actor: dependencies.accountId,
          kind,
        }),
      ),
  );

  server.registerTool(
    "content_collection_create",
    {
      title: "Create Topic or Guide",
      description:
        "Create a Topic or Guide. Its slug becomes the immutable canonical URL key.",
      inputSchema: z
        .object({
          kind: collectionKindSchema,
          name: z.string(),
          slug: z.string(),
          summary: z.string(),
        })
        .strict(),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ kind, name, slug, summary }) =>
      toToolResult(
        dependencies.authoring.createContentCollection({
          actor: dependencies.accountId,
          kind,
          name,
          slug,
          summary,
        }),
      ),
  );

  server.registerTool(
    "content_collection_update",
    {
      title: "Update Topic or Guide",
      description:
        "Update the mutable name and summary using the latest optimistic version. The canonical slug cannot change. " +
        "A Guide also carries the reader introduction: omit it to keep the stored text, send all four fields to replace it. A Topic has none.",
      inputSchema: z
        .object({
          collectionId: collectionIdSchema,
          expectedVersion: collectionVersionSchema,
          introduction: guideIntroductionSchema.optional(),
          kind: collectionKindSchema,
          name: z.string(),
          summary: z.string(),
        })
        .strict(),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ collectionId, expectedVersion, introduction, kind, name, summary }) =>
      toToolResult(
        dependencies.authoring.updateContentCollection({
          actor: dependencies.accountId,
          collectionId,
          expectedVersion,
          ...(introduction === undefined ? {} : { introduction }),
          kind,
          name,
          summary,
        }),
      ),
  );

  server.registerTool(
    "content_collection_set_archive",
    {
      title: "Archive or restore Topic or Guide",
      description:
        "Archive hides a collection from new assignments and public discovery while preserving existing links and canonical readers.",
      inputSchema: z
        .object({
          archived: z.boolean(),
          collectionId: collectionIdSchema,
          expectedVersion: collectionVersionSchema,
          kind: collectionKindSchema,
        })
        .strict(),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ archived, collectionId, expectedVersion, kind }) =>
      toToolResult(
        dependencies.authoring.setContentCollectionArchive({
          actor: dependencies.accountId,
          archived,
          collectionId,
          expectedVersion,
          kind,
        }),
      ),
  );

  server.registerTool(
    "playlist_load_composition",
    {
      title: "Load Guide composition",
      description:
        "Load the complete ordered Guide and the searchable pool of Materials with its optimistic order version.",
      inputSchema: z.object({ seriesId: collectionIdSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ seriesId }) =>
      toToolResult(
        dependencies.authoring.loadSeriesOrder({
          actor: dependencies.accountId,
          seriesId,
        }),
      ),
  );

  server.registerTool(
    "playlist_save_composition",
    {
      title: "Save complete Guide composition",
      description:
        "Atomically add, remove, and reorder the complete Guide composition using the latest order version. Chapters are the optional named groups of the main path: send the complete ordered list with stable identifiers and place every Material through chapterAssignments. Each chapter must stay one continuous run.",
      inputSchema: z
        .object({
          chapters: guideChapterDraftsSchema.optional(),
          chapterAssignments: guideChapterAssignmentsSchema.optional(),
          expectedOrderVersion: seriesOrderVersionSchema,
          orderedMaterialIds: z.array(materialIdWireSchema),
          stepGroups: seriesStepGroupsSchema.optional(),
          seriesId: collectionIdSchema,
        })
        .strict(),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      chapterAssignments,
      chapters,
      expectedOrderVersion,
      orderedMaterialIds,
      seriesId,
      stepGroups,
    }) =>
      toToolResult(
        dependencies.authoring.reorderSeries({
          actor: dependencies.accountId,
          chapterAssignments,
          chapters,
          expectedOrderVersion,
          orderedMaterialIds,
          seriesId,
          stepGroups,
        }),
      ),
  );

  server.registerTool(
    "guide_load_composition",
    {
      title: "Load Guide composition",
      description:
        "Load the complete ordered Guide and the searchable pool of Materials with its optimistic order version.",
      inputSchema: z.object({ guideId: collectionIdSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ guideId }) =>
      toToolResult(
        dependencies.authoring.loadSeriesOrder({
          actor: dependencies.accountId,
          seriesId: guideId,
        }),
      ),
  );

  server.registerTool(
    "guide_save_composition",
    {
      title: "Save complete Guide composition",
      description:
        "Atomically add, remove, and reorder the complete Guide composition using the latest order version. Chapters are the optional named groups of the main path: send the complete ordered list with stable identifiers and place every Material through chapterAssignments. Each chapter must stay one continuous run.",
      inputSchema: z
        .object({
          chapters: guideChapterDraftsSchema.optional(),
          chapterAssignments: guideChapterAssignmentsSchema.optional(),
          expectedOrderVersion: seriesOrderVersionSchema,
          orderedMaterialIds: z.array(materialIdWireSchema),
          stepGroups: seriesStepGroupsSchema.optional(),
          guideId: collectionIdSchema,
        })
        .strict(),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      chapterAssignments,
      chapters,
      expectedOrderVersion,
      orderedMaterialIds,
      guideId,
      stepGroups,
    }) =>
      toToolResult(
        dependencies.authoring.reorderSeries({
          actor: dependencies.accountId,
          chapterAssignments,
          chapters,
          expectedOrderVersion,
          orderedMaterialIds,
          seriesId: guideId,
          stepGroups,
        }),
      ),
  );

  return server;
}

async function toToolResult(
  pending: Promise<AuthoringResult>,
): Promise<CallToolResult> {
  const result = applicationResult.parse(await pending);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
    ...(result.ok ? {} : { isError: true }),
  };
}
