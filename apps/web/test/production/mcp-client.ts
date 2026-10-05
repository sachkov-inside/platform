import { z } from "zod";

import { passFetch } from "./pass-requests";

const protocolVersion = "2025-06-18";
const requestTimeoutMs = 30_000;

const rpcResultSchema = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string() })),
  }),
});
const toolPayloadSchema = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);
export type McpToolPayload = z.infer<typeof toolPayloadSchema>;

export interface McpToolCall {
  /** Статус HTTP ответа: без токена MCP отвечает 401 до вызова tool. */
  readonly status: number;
  /** Весь ответ транспорта: по нему проход ищет закрытые bytes. */
  readonly raw: string;
  /** Результат tool; его нет, если транспорт ответил ошибкой. */
  readonly payload: McpToolPayload | null;
}

/**
 * Вызов read-only tool учебного или владельческого MCP. Каждый запрос проходит allowlist прохода;
 * `accessToken: null` — вызов без Account.
 */
export async function callMcpTool(
  endpoint: string,
  accessToken: string | null,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<McpToolCall> {
  const initialized = await call(endpoint, accessToken, {
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "inside-production-access-pass", version: "1" },
    },
  });
  if (initialized.status !== 200) return { ...initialized, payload: null };
  const called = await call(endpoint, accessToken, {
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (called.status !== 200) return { ...called, payload: null };
  const [content] = rpcResultSchema.parse(rpcMessage(called.raw)).result
    .content;
  if (content === undefined) throw new Error(`MCP ${name} returned no content`);
  return {
    ...called,
    payload: toolPayloadSchema.parse(JSON.parse(content.text) as unknown),
  };
}

async function call(
  endpoint: string,
  accessToken: string | null,
  message: { readonly method: string; readonly params: unknown },
): Promise<{ readonly status: number; readonly raw: string }> {
  const response = await passFetch(endpoint, {
    method: "POST",
    headers: {
      ...(accessToken === null
        ? {}
        : { authorization: `Bearer ${accessToken}` }),
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  return { status: response.status, raw: await response.text() };
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
 * Отличительный текст закрытого ответа: самая поздняя строка не короче 40 символов из нескольких
 * слов. Тизер показывает только начало и описание, поэтому поздний абзац есть лишь в полном ответе.
 * `field` ограничивает поиск полями с этим именем: у тела урока это `text`, то есть то, что страница
 * показывает. Строки с символами, которые HTML или JSON экранируют, не берутся: экранированная
 * утечка иначе прошла бы поиск.
 */
export function distinctiveText(value: unknown, field?: string): string {
  const texts: string[] = [];
  const visit = (node: unknown, key: string | undefined): void => {
    if (typeof node === "string") {
      if (field === undefined || key === field) texts.push(node.trim());
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, key);
      return;
    }
    if (node !== null && typeof node === "object")
      for (const [childKey, child] of Object.entries(node))
        visit(child, childKey);
  };
  visit(value, undefined);
  const snippet = texts
    .filter(
      (text) =>
        text.length >= 40 &&
        text.split(" ").length >= 5 &&
        !/["'&<>\\]/u.test(text),
    )
    .at(-1);
  if (snippet === undefined) {
    throw new Error("Protected response has no distinctive text");
  }
  return snippet.slice(0, 80);
}
