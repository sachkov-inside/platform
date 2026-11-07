// PROTOTYPE, throwaway (#1984). Stage 3: the model writes 2-5 search queries per question,
// the same way the search tool will ask for them. Cached in .data/expansions.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateText, Output } from "ai";
import { z } from "zod";
import { model, chatModel, aitunnelPrice } from "./providers.ts";
import { record, total } from "./spend.ts";

const lines = (file: string) => (existsSync(new URL(`../.data/${file}`, import.meta.url)) ? readFileSync(new URL(`../.data/${file}`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const questions = [
  ...lines("questions-own-validated.jsonl").map((q) => ({ id: q.id, text: q.question })),
  ...lines("questions-telegram.jsonl").filter((q) => q.type === "material").map((q) => ({ id: q.id, text: q.query })),
];
const cacheFile = new URL("../.data/expansions.json", import.meta.url);
const cache: Record<string, string[]> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

const instructions = `Ты готовишь запросы к полнотекстовому поиску PostgreSQL по материалам курса «AI Engineering»:
разработка программ с coding-агентами (Codex, Claude Code), спецификации, тесты, ревью, MCP, harness, CI, развёртывание.
Поиск находит раздел, только если в нём есть слова запроса (с учётом форм слова).
Напиши от 2 до 5 коротких запросов по 2-6 слов. Используй слова, которыми автор курса скорее всего назвал бы тему:
синонимы, русские и английские термины, названия инструментов. Не повторяй вопрос дословно.`;

for (const q of questions.filter((q) => !cache[q.id])) {
  const result = await generateText({
    model: model("aitunnel"),
    instructions,
    prompt: q.text,
    output: Output.object({ schema: z.object({ queries: z.array(z.string()).min(2).max(5) }) }),
  });
  cache[q.id] = result.output.queries;
  const price = aitunnelPrice[chatModel.aitunnel];
  const input = result.usage.inputTokens ?? 0;
  const output = result.usage.outputTokens ?? 0;
  record({ stage: "3-expansions", provider: "aitunnel", model: chatModel.aitunnel, inputTokens: input, outputTokens: output, costRub: (input * price.input + output * price.output) / 1e6 });
  writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
}
console.log(`expansions: ${Object.keys(cache).length}; spent (by price list): ${total("3-expansions").toFixed(2)} ₽`);
