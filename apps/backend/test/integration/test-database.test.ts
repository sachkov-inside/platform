import { Pool } from "pg";
import { expect, test } from "vitest";

import { createTestDatabase } from "./setup/test-database.js";

test("disposal refuses a live connection instead of terminating its backend", async () => {
  const db = await createTestDatabase();
  const pool = new Pool({ connectionString: db.url, max: 1 });
  const state = { disposed: false };
  const errors: unknown[] = [];
  pool.on("error", (error: unknown) => errors.push(error));
  try {
    await pool.query("SELECT 1");
    await expect(
      db.dispose().then(() => {
        state.disposed = true;
      }),
    ).rejects.toMatchObject({ code: "55006" });
    expect((await pool.query("SELECT 1 AS value")).rows).toEqual([
      { value: 1 },
    ]);
    expect(errors).toEqual([]);
  } finally {
    await pool.end();
    if (!state.disposed) await db.dispose();
  }
});

test("disposal after pool shutdown lets the client finish disconnecting", async () => {
  const db = await createTestDatabase();
  const pool = new Pool({ connectionString: db.url, max: 1 });
  const errors: unknown[] = [];
  pool.on("error", (error: unknown) => errors.push(error));
  const client = await pool.connect();
  const disconnected = new Promise<void>((resolve) => {
    client.once("end", resolve);
  });
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
    await pool.end();
    await db.dispose();
    await disconnected;
  }
  expect(errors).toEqual([]);
});
