// PROTOTYPE, throwaway (#1984). Search variants over parts.
import { pool } from "./db.ts";

export type Hit = { id: string; score: number };

// "and": the site's current recipe, websearch_to_tsquery, every word must match.
// "or": any lexeme of the query may match; ts_rank_cd orders by how many and how close.
// The "simple" config keeps stop words, so the OR form uses only russian and english.
export async function words(query: string, mode: "and" | "or", limit = 30, rank = "ts_rank"): Promise<Hit[]> {
  const tsq =
    mode === "and"
      ? `(websearch_to_tsquery('russian', $1) || websearch_to_tsquery('english', $1) || websearch_to_tsquery('simple', $1))`
      : `(replace(plainto_tsquery('russian', $1)::text, '&', '|')::tsquery ||
          replace(plainto_tsquery('english', $1)::text, '&', '|')::tsquery )`;
  const { rows } = await pool.query(
    `SELECT id, ${rank}('{0.1,0.2,0.4,1.0}', search, x.q, 1) AS score
       FROM part, (SELECT ${tsq} AS q) x
      WHERE search @@ x.q
      ORDER BY score DESC, id
      LIMIT ${limit}`,
    [query],
  );
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}

export async function vectors(table: string, embedding: number[], limit = 30): Promise<Hit[]> {
  const { rows } = await pool.query(
    `SELECT part_id AS id, 1 - (embedding <=> $1::vector) AS score FROM ${table} ORDER BY embedding <=> $1::vector LIMIT ${limit}`,
    [JSON.stringify(embedding)],
  );
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}

// Reciprocal Rank Fusion, k = 60.
export function rrf(lists: Hit[][], limit = 30, k = 60): Hit[] {
  const scores = new Map<string, number>();
  for (const list of lists)
    list.forEach((hit, rank) => scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (k + rank + 1)));
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, limit);
}
