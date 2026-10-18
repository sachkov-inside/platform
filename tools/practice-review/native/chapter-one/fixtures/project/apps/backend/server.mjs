import Fastify from "fastify";
import pg from "pg";
import { healthResult } from "./health.mjs";
const app = Fastify();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
app.get("/health", async () =>
  healthResult((await pool.query("SELECT 1 AS ready")).rows),
);
await app.listen({ host: "0.0.0.0", port: 8081 });
async function stop() {
  await app.close();
  await pool.end();
}
process.once("SIGTERM", () => {
  void stop();
});
