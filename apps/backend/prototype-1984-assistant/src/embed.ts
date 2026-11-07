// PROTOTYPE, throwaway (#1984). Stage 3: vectors of all parts and all questions for one model.
// Run: node src/embed.ts text-embedding-3-small | qwen3-embedding-8b
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import "./providers.ts";
import { pool } from "./db.ts";
import { record, total } from "./spend.ts";

const modelId = process.argv[2];
const table = `vec_${modelId.replace(/\W/g, "_")}`;

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.aitunnel.ru/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AITUNNEL_API_KEY}` },
    body: JSON.stringify({ model: modelId, input: texts }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  record({ stage: "3-embeddings", provider: "aitunnel", model: modelId, inputTokens: json.usage?.prompt_tokens, costRub: json.usage?.cost_rub });
  return json.data.sort((a: { index: number }, b: { index: number }) => a.index - b.index).map((d: { embedding: number[] }) => d.embedding);
}

const { rows: parts } = await pool.query("SELECT id, path, body FROM part ORDER BY id");
const exists = (await pool.query("SELECT to_regclass($1) AS t", [table])).rows[0].t;
if (!exists) {
  const vectors: number[][] = [];
  for (let i = 0; i < parts.length; i += 32)
    vectors.push(...(await embed(parts.slice(i, i + 32).map((p) => `${p.path}\n\n${p.body}`))));
  await pool.query(`CREATE TABLE ${table} (part_id text PRIMARY KEY REFERENCES part(id), embedding vector(${vectors[0].length}) NOT NULL)`);
  for (let i = 0; i < parts.length; i++)
    await pool.query(`INSERT INTO ${table} VALUES ($1, $2::vector)`, [parts[i].id, JSON.stringify(vectors[i])]);
  console.log(`${table}: ${parts.length} parts, ${vectors[0].length} dimensions`);
}

const lines = (file: string) => (existsSync(new URL(`../.data/${file}`, import.meta.url)) ? readFileSync(new URL(`../.data/${file}`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const questions = [
  ...lines("questions-own-validated.jsonl").map((q) => ({ id: q.id, text: q.question })),
  ...lines("questions-telegram.jsonl").filter((q) => q.type === "material").map((q) => ({ id: q.id, text: q.query })),
];
const cacheFile = new URL("../.data/question-vectors.json", import.meta.url);
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
cache[modelId] ??= {};
const missing = questions.filter((q) => !cache[modelId][q.id]);
for (let i = 0; i < missing.length; i += 32) {
  const batch = missing.slice(i, i + 32);
  (await embed(batch.map((q) => q.text))).forEach((v, j) => (cache[modelId][batch[j].id] = v));
}
writeFileSync(cacheFile, JSON.stringify(cache));
console.log(`questions embedded: ${missing.length}; spent on embeddings so far: ${total("3-embeddings").toFixed(2)} ₽`);
await pool.end();
