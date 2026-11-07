import { words } from "./search.ts";
import { pool } from "./db.ts";
for (const q of ["как агенту не забывать прошлое", "что такое harness", "нужен ли TDD с агентом"]) {
  console.log(q, "AND:", (await words(q, "and", 3)).map(h=>h.id), "OR:", (await words(q, "or", 3)).map(h=>h.id));
}
await pool.end();
