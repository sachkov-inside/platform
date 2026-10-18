import { z } from "zod";

export const toolEnvelope = z.object({
  result: z.object({
    content: z.array(
      z.object({ type: z.string(), text: z.string().optional() }),
    ),
  }),
});
export function parseMcpResponse(text: string): unknown {
  if (
    !text.trimStart().startsWith("event:") &&
    !text.trimStart().startsWith("data:")
  )
    return JSON.parse(text) as unknown;
  const messages = text.split(/\r?\n\r?\n/u).flatMap((block) => {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data === "" ? [] : [JSON.parse(data) as unknown];
  });
  const response = messages.findLast(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      ("result" in message || "error" in message),
  );
  if (response === undefined)
    throw Error("MCP stream ended without a response");
  return response;
}
export function toolValue(wire: unknown): unknown {
  const text = toolEnvelope
    .parse(wire)
    .result.content.find((item) => item.type === "text")?.text;
  if (text === undefined) throw Error("MCP response has no text");
  return JSON.parse(text) as unknown;
}

export async function callTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw Error(`MCP HTTP ${String(response.status)}`);
  return toolValue(parseMcpResponse(await response.text()));
}

export const contextPartSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    contextVersion: z.hash("sha256"),
    contentSha256: z.hash("sha256"),
    data: z.string(),
    part: z.number().int(),
    partCount: z.number().int(),
    partSha256: z.hash("sha256"),
    contentBytes: z.number().int(),
    endOfContext: z.boolean(),
    nextPart: z.number().nullable(),
  }),
});
