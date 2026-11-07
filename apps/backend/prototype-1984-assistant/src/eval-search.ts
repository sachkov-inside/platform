// PROTOTYPE, throwaway (#1984). Search measurement: share of questions with an acceptable section
// in the first 10 and the average place (not found in the first 30 counts as 31).
// Variants that need paid calls read cached results from .data/ and are skipped when the cache is absent.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pool } from "./db.ts";
import { rrf, vectors, words, type Hit } from "./search.ts";

type Question = { id: string; question: string; set: string; kind: string; accept: string[] };

function load(file: string) {
  const path = new URL(`../.data/${file}`, import.meta.url);
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
}
const own: Question[] = load("questions-own-validated.jsonl")
  .filter((q) => q.verdict === "yes" || q.better)
  .map((q) => ({ id: q.id, question: q.question, set: "own", kind: q.kind, accept: [q.verdict === "yes" ? q.target : q.better, ...(q.alsoAcceptable ?? [])] }));
const telegram: Question[] = load("questions-telegram.jsonl")
  .filter((q) => q.type === "material" && q.target)
  .map((q) => ({ id: q.id, question: q.query, set: "telegram", kind: "telegram", accept: [q.target, ...(q.alsoAcceptable ?? [])] }));
const questions = [...own, ...telegram];

const expansions: Record<string, string[]> = existsSync(new URL("../.data/expansions.json", import.meta.url))
  ? JSON.parse(readFileSync(new URL("../.data/expansions.json", import.meta.url), "utf8"))
  : {};
const questionVectors: Record<string, Record<string, number[]>> = existsSync(new URL("../.data/question-vectors.json", import.meta.url))
  ? JSON.parse(readFileSync(new URL("../.data/question-vectors.json", import.meta.url), "utf8"))
  : {};
const reranked: Record<string, Record<string, string[]>> = existsSync(new URL("../.data/reranked.json", import.meta.url))
  ? JSON.parse(readFileSync(new URL("../.data/reranked.json", import.meta.url), "utf8"))
  : {};

const embeddingModels = Object.keys(questionVectors);
type Variant = { name: string; run: (q: Question) => Promise<Hit[] | null> };
const variants: Variant[] = [
  { name: "words, site recipe (AND)", run: (q) => words(q.question, "and") },
  { name: "words, one query (OR)", run: (q) => words(q.question, "or", 30, process.env.RANK ?? "ts_rank") },
  {
    name: "words, 2-5 model queries",
    run: async (q) => (expansions[q.id] ? rrf(await Promise.all(expansions[q.id].map((x) => words(x, "or")))) : null),
  },
  ...embeddingModels.flatMap((model): Variant[] => [
    { name: `meaning, ${model}`, run: async (q) => vectors(`vec_${model.replace(/\W/g, "_")}`, questionVectors[model][q.id]) },
    {
      name: `hybrid RRF, ${model}`,
      run: async (q) =>
        expansions[q.id]
          ? rrf([...(await Promise.all(expansions[q.id].map((x) => words(x, "or")))), await vectors(`vec_${model.replace(/\W/g, "_")}`, questionVectors[model][q.id])])
          : null,
    },
  ]),
  ...Object.keys(reranked).map((name): Variant => ({
    name,
    run: async (q) => (reranked[name][q.id] ? reranked[name][q.id].map((id, i) => ({ id, score: -i })) : null),
  })),
];

// How many of the question's words occur in the accepted section: a high share means an easy question.
async function overlap(q: Question): Promise<number> {
  const { rows } = await pool.query(
    `WITH ql AS (SELECT unnest(tsvector_to_array(to_tsvector('russian', $1) || to_tsvector('english', $1))) AS l)
     SELECT count(*) FILTER (WHERE l = ANY (tsvector_to_array(p.search)))::float / greatest(count(*), 1) AS share
       FROM ql, part p WHERE p.id = $2`,
    [q.question, q.accept[0]],
  );
  return Number(rows[0]?.share ?? 0);
}

const places: Record<string, Record<string, number>> = {};
const report: string[] = [];
const overlaps = new Map<string, number>();
for (const q of questions) overlaps.set(q.id, await overlap(q));
for (const variant of variants) {
  places[variant.name] = {};
  for (const q of questions) {
    const hits = await variant.run(q);
    if (!hits) continue;
    const index = hits.findIndex((h) => q.accept.includes(h.id));
    places[variant.name][q.id] = index < 0 ? 31 : index + 1;
  }
}
for (const set of ["own", "telegram", "all"]) {
  const subset = questions.filter((q) => set === "all" || q.set === set);
  if (!subset.length) continue;
  report.push(`\n${set}: ${subset.length} questions`);
  for (const [name, byQuestion] of Object.entries(places)) {
    const measured = subset.filter((q) => byQuestion[q.id] !== undefined);
    if (!measured.length) continue;
    const top10 = measured.filter((q) => byQuestion[q.id] <= 10).length / measured.length;
    const top3 = measured.filter((q) => byQuestion[q.id] <= 3).length / measured.length;
    const mean = measured.reduce((a, q) => a + byQuestion[q.id], 0) / measured.length;
    report.push(`  ${name.padEnd(34)} top10 ${(top10 * 100).toFixed(0).padStart(3)}%  top3 ${(top3 * 100).toFixed(0).padStart(3)}%  mean place ${mean.toFixed(1)}  (n=${measured.length})`);
  }
}
const kinds = [...new Set(own.map((q) => q.kind))];
report.push("\nown questions, top10 by kind");
for (const [name, byQuestion] of Object.entries(places)) {
  const cells = kinds.map((kind) => {
    const subset = own.filter((q) => q.kind === kind && byQuestion[q.id] !== undefined);
    return `${kind} ${subset.length ? Math.round((subset.filter((q) => byQuestion[q.id] <= 10).length / subset.length) * 100) : "-"}%`;
  });
  report.push(`  ${name.padEnd(34)} ${cells.join("  ")}`);
}
const meanOverlap = [...overlaps.values()].reduce((a, b) => a + b, 0) / overlaps.size;
report.push(`\nword overlap with the accepted section: mean ${(meanOverlap * 100).toFixed(0)}%, questions over 70%: ${[...overlaps].filter(([, v]) => v > 0.7).map(([id]) => id).join(", ") || "none"}`);
console.log(report.join("\n"));
writeFileSync(new URL("../.data/places.json", import.meta.url), JSON.stringify({ places, overlaps: Object.fromEntries(overlaps) }, null, 1));
await pool.end();
