// PROTOTYPE, throwaway (#1984). Stage 4: a reranker reorders the 30 best parts found by meaning.
// Run: node src/rerank.ts rerank-5-fast
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import "./providers.ts";
import { pool } from "./db.ts";
import { vectors } from "./search.ts";
import { record, total } from "./spend.ts";

const modelId = process.argv[2] ?? "rerank-5-fast";
const poolModel = "qwen3-embedding-8b";
const name = `rerank ${modelId} over meaning ${poolModel}`;
const lines = (file: string) => (existsSync(new URL(`../.data/${file}`, import.meta.url)) ? readFileSync(new URL(`../.data/${file}`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const questions = [
  ...lines("questions-own-validated.jsonl").filter((q) => q.verdict === "yes" || q.better).map((q) => ({ id: q.id, text: q.question })),
  ...lines("questions-telegram.jsonl").filter((q) => q.type === "material" && q.target).map((q) => ({ id: q.id, text: q.query })),
];
const questionVectors = JSON.parse(readFileSync(new URL("../.data/question-vectors.json", import.meta.url), "utf8"));
const cacheFile = new URL("../.data/reranked.json", import.meta.url);
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
cache[name] ??= {};
const { rows } = await pool.query("SELECT id, path, body FROM part");
const parts = new Map(rows.map((r) => [r.id, `${r.path}\n\n${r.body}`]));
const times: number[] = [];

for (const q of questions.filter((q) => !cache[name][q.id])) {
  const candidates = (await vectors(`vec_${poolModel.replace(/\W/g, "_")}`, questionVectors[poolModel][q.id], 30)).map((h) => h.id);
  const started = Date.now();
  const res = await fetch("https://api.aitunnel.ru/v1/rerank", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AITUNNEL_API_KEY}` },
    body: JSON.stringify({ model: modelId, query: q.text, documents: candidates.map((id) => parts.get(id)), top_n: candidates.length }),
  });
  const json = await res.json();
  times.push(Date.now() - started);
  if (!res.ok) throw new Error(JSON.stringify(json));
  record({ stage: "4-rerank", provider: "aitunnel", model: modelId, inputTokens: json.usage?.total_tokens ?? json.usage?.prompt_tokens, costRub: json.usage?.cost_rub });
  cache[name][q.id] = json.results.map((r: { index: number }) => candidates[r.index]);
  writeFileSync(cacheFile, JSON.stringify(cache));
}
times.sort((a, b) => a - b);
console.log({ name, questions: Object.keys(cache[name]).length, medianMs: times[Math.floor(times.length / 2)], p90Ms: times[Math.floor(times.length * 0.9)], spentRub: total("4-rerank").toFixed(2) });
await pool.end();
