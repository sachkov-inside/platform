import {
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";

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

const collectionKindSchema = z.enum(["series", "topic"]);
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
        "Manage Topics, Playlists, playlist composition, and the complete current Material through the same Platform application rules. " +
        "Save may publish, unpublish, replace live content, or change access immediately. " +
        "Always reload after stale content, collection, or playlist order errors; successful Saves have no server-side Undo or history.",
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
        "Atomically replace content, metadata, relations, access, and publication state. This may change live content immediately and has no server-side Undo or history.",
      inputSchema: z
        .object({
          idempotencyKey: idempotencyKeyWireSchema,
          materialId: materialIdWireSchema,
          expectedContentVersion: contentVersionWireSchema,
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
      title: "List Topics or Playlists",
      description:
        "List all active and archived Topics or Playlists with optimistic versions and Material counts.",
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
      title: "Create Topic or Playlist",
      description:
        "Create a Topic or Playlist. Its slug becomes the immutable canonical URL key.",
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
      title: "Update Topic or Playlist",
      description:
        "Update the mutable name and summary using the latest optimistic version. The canonical slug cannot change.",
      inputSchema: z
        .object({
          collectionId: collectionIdSchema,
          expectedVersion: collectionVersionSchema,
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
    ({ collectionId, expectedVersion, kind, name, summary }) =>
      toToolResult(
        dependencies.authoring.updateContentCollection({
          actor: dependencies.accountId,
          collectionId,
          expectedVersion,
          kind,
          name,
          summary,
        }),
      ),
  );

  server.registerTool(
    "content_collection_set_archive",
    {
      title: "Archive or restore Topic or Playlist",
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
      title: "Load Playlist composition",
      description:
        "Load the complete ordered Playlist and the searchable pool of Materials with its optimistic order version.",
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
      title: "Save complete Playlist composition",
      description:
        "Atomically add, remove, and reorder the complete Playlist composition using the latest order version.",
      inputSchema: z
        .object({
          expectedOrderVersion: seriesOrderVersionSchema,
          orderedMaterialIds: z.array(materialIdWireSchema),
          seriesId: collectionIdSchema,
        })
        .strict(),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ expectedOrderVersion, orderedMaterialIds, seriesId }) =>
      toToolResult(
        dependencies.authoring.reorderSeries({
          actor: dependencies.accountId,
          expectedOrderVersion,
          orderedMaterialIds,
          seriesId,
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
