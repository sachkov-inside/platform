import {
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

const uuid = z.uuid();
const idempotencyKey = z.string().trim().min(1).max(200);
const contentVersion = z.number().int().positive();
const publicationState = z.enum(["draft", "published", "unpublished"]);
const seriesMembership = z
  .object({ seriesId: uuid, ordinal: z.number().int().positive() })
  .strict();
const materialMetadata = z
  .object({
    title: z.string().trim().min(1).max(160).nullable(),
    summary: z.string().trim().min(1).max(500).nullable(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .max(120)
      .nullable(),
    access: z.enum(["free", "membership"]),
    topicId: uuid.nullable(),
    formatId: uuid.nullable(),
    tagIds: z.array(uuid).max(100),
    seriesMemberships: z.array(seriesMembership).max(100),
  })
  .strict();
const materialBody = z
  .object({
    schemaVersion: z.literal(1),
    doc: z.record(z.string(), z.json()),
  })
  .strict();
const applicationResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.json() }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.looseObject({ code: z.string() }),
    })
    .strict(),
]);

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
        "Manage the complete current Material through create, load, full-state Save, and Preview. " +
        "Save may publish, unpublish, replace live content, or change access immediately. " +
        "Always reload after a stale_content_version error; successful Saves have no server-side Undo or history.",
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
          idempotencyKey,
          metadata: materialMetadata,
          body: materialBody,
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
      inputSchema: z.object({ materialId: uuid }).strict(),
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
          idempotencyKey,
          materialId: uuid,
          expectedContentVersion: contentVersion,
          publicationState,
          metadata: materialMetadata,
          body: materialBody,
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
      inputSchema: z.object({ materialId: uuid }).strict(),
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
