import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  COMMUNITY_DISCUSSIONS_VERSION,
  communityDiscussionsRequestSchema,
} from "@inside/contracts/community-discussions";
import type { CommunityDiscussions } from "../../facets/community-discussions/community-discussions.js";

export function registerCommunityDiscussionsTools(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly communityDiscussions: Pick<CommunityDiscussions, "execute">;
  },
): void {
  for (const schema of communityDiscussionsRequestSchema.options) {
    const {
      actor: _actor,
      contractVersion: _version,
      operation: operationSchema,
      ...shape
    } = schema.shape;
    const operation = operationSchema.value;
    const readOnly = operation !== "discussions.mark";
    server.registerTool(
      `community_${operation.replaceAll(".", "_")}`,
      {
        title: operation,
        description: readOnly
          ? "Read factual community questions, attributed answers and source links with the current author's communications:manage permission. List unreviewedOnly=true for new or substantively updated discussions, including reviewed/used statuses. changedSince filters content updates, not manual marks. Follow nextCursor until null. hasChanges distinguishes additions from pure repeats."
          : "Set a discussion status. Pass expectedRevision from read to acknowledge exactly the content reviewed; a newer revision returns operation_conflict. reviewed/used acknowledge that revision, new/awaiting_answer remove its acknowledgement. used requires Material URLs. Reuse requestId and the complete input after an uncertain response.",
        inputSchema: z.strictObject(shape),
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        const result = await dependencies.communityDiscussions.execute(
          dependencies.accountId,
          {
            ...input,
            contractVersion: COMMUNITY_DISCUSSIONS_VERSION,
            operation,
          },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          ...(!result.ok ? { isError: true } : {}),
        };
      },
    );
  }
}
