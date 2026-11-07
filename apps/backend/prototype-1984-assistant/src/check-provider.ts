// PROTOTYPE, throwaway (#1984). Check 1: streaming and parallel tool calls through each provider.
// One question that needs two independent tools; the script prints the order of stream parts,
// how many tool calls came in one step, the time to the first text and the token usage.
// Run: node src/check-provider.ts aitunnel|deepseek
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { balances, model, type ProviderName } from "./providers.ts";

const name = (process.argv[2] ?? "aitunnel") as ProviderName;
const calls: string[] = [];
const agent = new ToolLoopAgent({
  model: model(name),
  instructions:
    "Ты Помощник курса. Отвечай коротко по-русски. Если для ответа нужны и доступ ученика, и поиск по материалам, вызывай оба инструмента сразу, в одном шаге.",
  tools: {
    check_access: tool({
      description: "Доступ ученика к курсу: открыт ли урок.",
      inputSchema: z.object({ lesson: z.string() }),
      execute: async ({ lesson }) => (calls.push(`check_access(${lesson}) at ${Date.now()}`), { lesson, available: false, reason: "урок второй главы откроется после оплаты главы" }),
    }),
    search_materials: tool({
      description: "Поиск по материалам курса. queries: 2-5 вариантов запроса с синонимами.",
      inputSchema: z.object({ queries: z.array(z.string()).min(1).max(5) }),
      execute: async ({ queries }) => (calls.push(`search_materials(${queries.join(" | ")}) at ${Date.now()}`), { results: [{ title: "Тестирование с агентом: поведение и TDD", section: "Зачем агенту TDD" }] }),
    }),
  },
  stopWhen: isStepCount(4),
});

const before = await balances();
const started = Date.now();
let firstText: number | null = null;
const parts: string[] = [];
const result = await agent.stream({ prompt: "Почему у меня закрыт урок про TDD и о чём он вообще?" });
for await (const part of result.fullStream) {
  if (part.type === "text-delta" && firstText === null) firstText = Date.now() - started;
  if (["start-step", "tool-call", "tool-result", "finish-step", "error"].includes(part.type) || (part.type === "text-delta" && parts.at(-1) !== "text-delta"))
    parts.push(part.type === "tool-call" ? `tool-call:${part.toolName}` : part.type);
  if (part.type === "error") console.error(part.error);
}
const steps = await result.steps;
const usage = await result.totalUsage;
console.log({
  provider: name,
  streamOrder: parts.join(" → "),
  toolCallsPerStep: steps.map((s) => s.toolCalls.length),
  toolExecutions: calls,
  firstTextMs: firstText,
  totalMs: Date.now() - started,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  text: (await result.text).slice(0, 300),
});
// Balances update with a delay; the summary script compares them later.
console.log("balance before", before);
