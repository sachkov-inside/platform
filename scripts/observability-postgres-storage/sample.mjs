// @ts-check
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { SQL, controls, packet } from "./query.mjs";
/** @typedef {(value:string)=>string|boolean} Parser */
/** @typedef {{text:string,rowMode?:"array",binary?:boolean,query_timeout:number,types?:{getTypeParser:(oid:number,format:string)=>Parser}}} Statement */
/** @typedef {{connect:()=>Promise<unknown>,query:(statement:Statement)=>Promise<unknown>,end:()=>Promise<unknown>}} SourceClient */
/** @param {string} password @param {number} remainingMs */
export function configuration(password, remainingMs) {
  if (
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 128 ||
    !Number.isFinite(remainingMs) ||
    remainingMs <= 0 ||
    remainingMs > 4000
  )
    throw new Error("credentials");
  /** @type {"postgres"} */ const negotiation = "postgres";
  return {
    host: "127.0.0.1",
    port: 15432,
    database: "tracking",
    user: "postgres_source_reader",
    password,
    ssl: false,
    sslnegotiation: negotiation,
    client_encoding: "UTF8",
    application_name: "inside-postgresql-source",
    options:
      "-c search_path=pg_catalog -c statement_timeout=2000 -c lock_timeout=250 -c idle_in_transaction_session_timeout=3000",
    connectionTimeoutMillis: Math.min(
      2000,
      Math.max(1, Math.floor(remainingMs)),
    ),
    binary: false,
    pipeline: false,
  };
}
/** Public client lifecycle seam: all statements fixed; an active end is never a successful sample.
 * @param {SourceClient} client @param {() => number} remainingMs @param {() => number} completedUs */
export async function acquire(client, remainingMs, completedUs) {
  let result;
  let failed = false;
  /** @type {unknown} */ let primary;
  try {
    await client.connect();
    for (const text of [...controls, SQL]) {
      const remaining = remainingMs();
      if (!Number.isFinite(remaining) || remaining <= 0)
        throw new Error("query_timeout");
      result = await client.query({
        text,
        rowMode: "array",
        binary: false,
        query_timeout: Math.min(2500, Math.max(1, Math.floor(remaining))),
        types: {
          getTypeParser(oid, format) {
            if (format !== "text" || (oid !== 25 && oid !== 16))
              throw new Error("malformed");
            return (value) => {
              if (typeof value !== "string") throw new Error("malformed");
              if (oid === 25) return value;
              if (value !== "t" && value !== "f") throw new Error("malformed");
              return value === "t";
            };
          },
        },
      });
    }
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    try {
      const remaining = remainingMs();
      await client.query({
        text: "ROLLBACK",
        query_timeout: Math.min(2500, Math.max(1, Math.floor(remaining))),
      });
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    } finally {
      try {
        await client.end();
      } catch (error) {
        if (!failed) {
          failed = true;
          primary = error;
        }
      }
    }
  }
  if (failed) throw primary;
  if (remainingMs() <= 0) throw new Error("query_timeout");
  return packet(result, completedUs());
}
export async function main() {
  if (
    process.version !== "v26.10.0" ||
    process.argv.length !== 2 ||
    Object.keys(process.env).some(
      (key) =>
        ![
          "PATH",
          "INSIDE_PG_SOURCE_PASSWORD",
          "INSIDE_PG_SOURCE_WORK_MS",
        ].includes(key),
    )
  )
    throw new Error("credentials");
  const started = performance.now();
  const budget = Number(process.env["INSIDE_PG_SOURCE_WORK_MS"]);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 4000)
    throw new Error("query_timeout");
  const require = createRequire(
    new URL("../../apps/backend/package.json", import.meta.url),
  );
  // The untyped CommonJS loader is confined to this existing backend proof dependency port.
  // oxlint-disable typescript/no-unsafe-type-assertion
  const pg =
    /** @type {typeof import('../../apps/backend/test/support/proof-dependencies.js')} */ (
      require("pg")
    );
  // oxlint-enable typescript/no-unsafe-type-assertion
  const client = new pg.Client(
    configuration(
      process.env["INSIDE_PG_SOURCE_PASSWORD"] ?? "",
      budget - (performance.now() - started),
    ),
  );
  const wire = await acquire(
    client,
    () => budget - (performance.now() - started),
    () => Date.now() * 1000,
  );
  process.stdout.write(wire);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
