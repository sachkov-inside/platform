import { z } from "zod";

import { productionTarget } from "./pass-config";

const protocolVersion = "2025-06-18";
const requestTimeoutMs = 30_000;
/** Проход вызывает только этот read-only tool учебного MCP. */
const readTool = "learning_material_read";

const rpcResultSchema = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string() })),
  }),
});
const toolPayloadSchema = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);

export type LearnerMaterialRead = z.infer<typeof toolPayloadSchema> & {
  /** Весь ответ транспорта: по нему проход ищет закрытые bytes. */
  readonly raw: string;
};

export async function readLearnerMaterial(
  accessToken: string,
  slug: string,
): Promise<LearnerMaterialRead> {
  await call(accessToken, {
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "inside-production-access-pass", version: "1" },
    },
  });
  const raw = await call(accessToken, {
    method: "tools/call",
    params: { name: readTool, arguments: { slug } },
  });
  const [content] = rpcResultSchema.parse(rpcMessage(raw)).result.content;
  if (content === undefined) throw new Error("Learner MCP returned no content");
  return {
    ...toolPayloadSchema.parse(JSON.parse(content.text) as unknown),
    raw,
  };
}

async function call(
  accessToken: string,
  message: { readonly method: string; readonly params: unknown },
): Promise<string> {
  const response = await fetch(productionTarget.learnerMcp, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Learner MCP ${message.method} failed: ${String(response.status)}`,
    );
  }
  return response.text();
}

/** Ответ приходит JSON или одним событием SSE `data:`. */
function rpcMessage(raw: string): unknown {
  const data = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(data.length > 0 ? data.join("") : raw) as unknown;
}

/**
 * Отличительный текст закрытого тела: самый поздний абзац не короче 40 символов. Тизер показывает
 * только начало и описание, поэтому поздний абзац есть лишь в полном теле.
 */
export function protectedBodySnippet(value: unknown): string {
  const texts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "text" && typeof child === "string") texts.push(child);
      else visit(child);
    }
  };
  visit(z.object({ body: z.unknown() }).parse(value).body);
  // Без символов, которые HTML или JSON экранируют: экранированная утечка иначе прошла бы поиск.
  const snippet = texts
    .map((text) => text.trim())
    .filter((text) => text.length >= 40 && !/["'&<>\\]/u.test(text))
    .at(-1);
  if (snippet === undefined) {
    throw new Error("Protected body has no distinctive paragraph");
  }
  return snippet.slice(0, 80);
}
