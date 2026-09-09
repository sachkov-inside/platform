import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Videos } from "../../facets/videos/videos.interface.js";
import { videoAttachmentBodySchema, videoUploadBodySchema } from "../video-authoring-wire.js";

export type VideoAuthoringTools = Pick<Videos, "attachExisting" | "initUpload" | "reconcile">;

export function registerVideoTools(server: McpServer, dependencies: {
  readonly accountId: string;
  readonly videos: VideoAuthoringTools;
}): void {
  server.registerTool("video_attach_existing", {
    title: "Attach existing Kinescope video",
    description: "Register the exact provider Video ID for one Material and its access class. Enforces the configured project and ownership; never moves or uploads video bytes. Load the Material first. Then use material_save with the returned videoId as primaryVideoId and the loaded contentVersion to select it. Attachment alone does not publish or change the primary Video.",
    inputSchema: videoAttachmentBodySchema.extend({ materialId: z.uuid() }).strict(),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => toolResult(dependencies.videos.attachExisting({ ...input, actor: dependencies.accountId })));

  server.registerTool("video_init_upload", {
    title: "Initialize resumable video upload",
    description: "Initialize the same Tus upload used by the editor. Reuse idempotencyKey on retry. This returns a limited uploadEndpoint; it does not transmit file bytes. Transfer the local file with a Tus client outside the model context, then reconcile. On upload_outcome_unknown, stop and inspect the upload attempt/provider state before another attempt; do not invent a new key to bypass the uncertainty.",
    inputSchema: videoUploadBodySchema.extend({ materialId: z.uuid(), idempotencyKey: z.string().min(1).max(128) }).strict(),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => toolResult(dependencies.videos.initUpload({ ...input, actor: dependencies.accountId })));

  server.registerTool("video_reconcile", {
    title: "Refresh video processing state",
    description: "Read Kinescope and reconcile the local Video lifecycle. Returns actual ready, processing or failed state; does not publish the Material.",
    inputSchema: z.object({ videoId: z.uuid() }).strict(),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => toolResult(dependencies.videos.reconcile({ ...input, actor: dependencies.accountId })));
}

async function toolResult(pending: Promise<{ readonly ok: boolean }>): Promise<CallToolResult> {
  const result = await pending;
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, ...(!result.ok ? { isError: true } : {}) };
}
