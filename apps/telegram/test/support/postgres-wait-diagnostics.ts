import { Client } from "pg";
import { z } from "zod";

const connectionBudgetMilliseconds = 500;
const statementBudgetMilliseconds = 500;
const responseBudgetMilliseconds = 1_000;
const sessionsSchema = z.array(
  z.object({
    pid: z.number().int(),
    state: z.string().nullable(),
    waitEventType: z.string().nullable(),
    waitEvent: z.string().nullable(),
    queryAgeMilliseconds: z.number().nullable(),
    blockingPids: z.array(z.number().int()),
  }),
);

/** Failure-only observer of the owned test database. Never retain SQL, URLs or query parameters. */
export async function postgresWaitDiagnostics(databaseUrl: string) {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: connectionBudgetMilliseconds,
    statement_timeout: statementBudgetMilliseconds,
    query_timeout: responseBudgetMilliseconds,
  });
  try {
    await client.connect();
    const result = await client.query(`
      select pid, state, wait_event_type as "waitEventType", wait_event as "waitEvent",
        extract(epoch from (clock_timestamp() - query_start))::float8 * 1000 as "queryAgeMilliseconds",
        pg_blocking_pids(pid) as "blockingPids"
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
      order by pid limit 32
    `);
    return {
      status: "captured" as const,
      sessions: sessionsSchema.parse(result.rows),
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      error: error instanceof Error ? error.name : "unknown",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
