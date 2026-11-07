// PROTOTYPE, throwaway (#1984). Loads parts into the scratch database with the same
// tsvector recipe as the site's material search (russian || english || simple, heading weighted A).
import { readFileSync } from "node:fs";
import { pool } from "./db.ts";
import type { Part } from "./corpus.ts";

const parts = JSON.parse(readFileSync(new URL("../.data/parts.json", import.meta.url), "utf8")) as Part[];

await pool.query(`
  CREATE EXTENSION IF NOT EXISTS vector;
  DROP TABLE IF EXISTS part;
  CREATE TABLE part (
    id text PRIMARY KEY,
    material_id text NOT NULL,
    material_title text NOT NULL,
    access text NOT NULL,
    heading text NOT NULL,
    path text NOT NULL,
    body text NOT NULL,
    search tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('russian', path) || to_tsvector('english', path) || to_tsvector('simple', path), 'A') ||
      setweight(to_tsvector('russian', body) || to_tsvector('english', body) || to_tsvector('simple', body), 'D')
    ) STORED
  );
  CREATE INDEX part_search ON part USING gin (search);
`);
for (const p of parts)
  await pool.query(
    "INSERT INTO part (id, material_id, material_title, access, heading, path, body) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [p.id, p.materialId, p.materialTitle, p.access, p.heading, p.path, p.text],
  );
const { rows } = await pool.query("SELECT count(*)::int AS n, pg_size_pretty(pg_total_relation_size('part')) AS size FROM part");
console.log(rows[0]);
await pool.end();
