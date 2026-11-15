import { Client } from "pg";
import { expect, it } from "vitest";
import { hasText } from "../../src/shared/text.js";
import { postgresWaitDiagnostics } from "../support/postgres-wait-diagnostics.js";

const connectionBudgetMilliseconds = 1_000;
const queryBudgetMilliseconds = 4_000;

it("reports the blocking test session without retaining SQL or connection metadata", async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!hasText(databaseUrl)) throw new Error("DATABASE_URL required");
  const owner = new Client({
    connectionTimeoutMillis: connectionBudgetMilliseconds,
    query_timeout: queryBudgetMilliseconds,
    connectionString: databaseUrl,
    application_name: "private-test-app",
  });
  const waiter = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: connectionBudgetMilliseconds,
    query_timeout: queryBudgetMilliseconds,
  });
  let waiting: Promise<unknown> | undefined;
  try {
    await owner.connect();
    await waiter.connect();
    const owned = await owner.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    const ownerPid = owned.rows[0]?.pid;
    const pending = await waiter.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    const waiterPid = pending.rows[0]?.pid;
    await owner.query("select pg_advisory_lock(2094)");
    waiting = waiter
      .query("select pg_advisory_lock(2094) /* private-test-query */")
      .catch(() => undefined);
    await expect
      .poll(async () => {
        const snapshot = await postgresWaitDiagnostics(databaseUrl);
        expect(JSON.stringify(snapshot)).not.toContain("private-test");
        return snapshot.status === "captured"
          ? snapshot.sessions.find(({ pid }) => pid === waiterPid)
          : undefined;
      })
      .toMatchObject({ waitEventType: "Lock", blockingPids: [ownerPid] });
  } finally {
    // end() cancels an active query; never await the held lock before cancelling its owner.
    try {
      await waiter.end();
      await waiting;
    } finally {
      await owner.end();
    }
  }
});

it("reports unavailable connection diagnostics without retaining the connection value", async () => {
  const result = await postgresWaitDiagnostics(
    "postgresql://private-test@localhost:invalid/example",
  );
  expect(result.status).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("private-test");
});
