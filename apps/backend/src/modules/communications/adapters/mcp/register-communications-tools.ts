import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { COMMUNICATIONS_VERSION, managementSchemas } from "../../communications-contract.js";
import type { Communications } from "../../facets/communications/communications.js";
import { templateReferenceSchema } from "../../features/manage-communications/template-reference.js";

const readOperations = new Set(["templates.read", "funnels.read", "funnels.list", "funnels.preview", "broadcasts.read", "intro.read", "deliveries.read", "statistics.read"]);

export function registerCommunicationsTools(server: McpServer, dependencies: { readonly accountId: string; readonly communications: Pick<Communications, "execute"> }): void {
  for (const schema of managementSchemas) {
    const operation = schema.shape.operation.value;
    const readOnly = readOperations.has(operation);
    const inputSchema: z.ZodObject<z.ZodRawShape> = schema.omit({ contractVersion: true, operation: true });
    server.registerTool(`communications_${operation.replaceAll(".", "_")}`, {
      title: operation,
      description: description(operation, readOnly),
      inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: true, openWorldHint: !readOnly },
    }, async input => {
      const result = await dependencies.communications.execute(dependencies.accountId, { ...input, contractVersion: COMMUNICATIONS_VERSION, operation });
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, ...(!result.ok ? { isError: true } : {}) };
    });
  }
  server.registerTool("communications_templates_resolve", {
    title: "Read template by reference",
    description: "Parse a template ID or HTTPS /communications/templates/<uuid> link, then read it with the current author's permission. The link is never fetched.",
    inputSchema: z.strictObject({ reference: z.string().min(1).max(2048), operationId: z.guid() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const reference = templateReferenceSchema.safeParse(input.reference);
    const result = reference.success ? await dependencies.communications.execute(dependencies.accountId, {
      contractVersion: COMMUNICATIONS_VERSION, operation: "templates.read", operationId: input.operationId,
      expectedRevision: 0, payload: { templateId: reference.data },
    }) : { ok: false, error: { code: "invalid_input" } };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, ...(!result.ok ? { isError: true } : {}) };
  });
}

function description(operation: string, readOnly: boolean): string {
  if (operation === "templates.testSend") return "Explicitly send the template only to the confirmed Telegram author. This is an external send, unlike read or preview. Reuse operationId on retry.";
  if (operation === "delivery.resolve") return "Explicitly skip or retry one delivery part with expectedRevision. Retrying an unknown outcome risks a duplicate and requires duplicateRiskAccepted=true. Preserve operationId on retry.";
  if (operation === "funnels.preview") return "Preview the publication diff and audience impact. Sends no messages and does not publish.";
  return `${readOnly ? "Read" : "Execute"} ${operation} with the current communications permission. ${readOnly ? "Sends no messages." : "May change published communications or trigger audience delivery; no additional UI approval gate."} Preserve operationId and expectedRevision when repeating the same request. sources are part of funnels.save.`;
}
