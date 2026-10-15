import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../src/infrastructure/prisma/generated/client.js";
import { guardTransactionConnections } from "./transaction-guard.js";

/**
 * Count real result rows separately from Prisma SQL events without retaining business rows.
 * Optional fixture diagnostics retain only the first eligibility statement until client disposal.
 */
export function createQueryRowClient(
  connectionString: string,
  captureEligibilityPlan = false,
) {
  const statements: string[] = [];
  const rows: { statement: string; count: number; serializedBytes: number }[] =
    [];
  let eligibility: { text: string; values: readonly unknown[] } | undefined;
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on("connect", (client) => {
    client.query = new Proxy(client.query.bind(client), {
      apply(target, receiver: unknown, args: unknown[]) {
        const input = args[0];
        const statement =
          typeof input === "string"
            ? input
            : typeof input === "object" &&
                input !== null &&
                "text" in input &&
                typeof input.text === "string"
              ? input.text
              : "";
        if (
          captureEligibilityPlan &&
          eligibility === undefined &&
          statement.includes("SELECT DISTINCT account_id FROM effective") &&
          typeof input === "object" &&
          input !== null &&
          "values" in input &&
          Array.isArray(input.values)
        ) {
          eligibility = { text: statement, values: input.values };
        }
        const record = (response: unknown) => {
          if (
            typeof response === "object" &&
            response !== null &&
            "rows" in response &&
            Array.isArray(response.rows)
          )
            rows.push({
              statement,
              count: response.rows.length,
              serializedBytes:
                response.rows.length === 0
                  ? 0
                  : Buffer.byteLength(
                      JSON.stringify(response.rows, (_key, value: unknown) =>
                        typeof value === "bigint" ? value.toString() : value,
                      ),
                      "utf8",
                    ),
            });
        };
        const callback = args.at(-1);
        if (typeof callback === "function") {
          const observedArgs = [
            ...args.slice(0, -1),
            function (this: unknown, ...response: unknown[]) {
              record(response[1]);
              const returned: unknown = Reflect.apply(callback, this, response);
              return returned;
            },
          ];
          const result: unknown = Reflect.apply(target, receiver, observedArgs);
          return result;
        }
        const result: unknown = Reflect.apply(target, receiver, args);
        if (
          typeof result !== "object" ||
          result === null ||
          !("then" in result) ||
          typeof result.then !== "function"
        )
          return result;
        const tracked: unknown = Reflect.apply(result.then, result, [
          (response: unknown) => {
            record(response);
            return response;
          },
        ]);
        return tracked;
      },
    });
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    log: [{ emit: "event", level: "query" }],
  });
  prisma.$on("query", (event) => statements.push(event.query));
  const guarded = guardTransactionConnections(prisma);
  return {
    prisma: guarded.prisma,
    async explainEligibility() {
      if (eligibility === undefined)
        throw new Error("Missing measured eligibility statement");
      // Fixture-only investigation; no query parameters are printed or retained after disposal.
      const result = await pool.query({
        text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${eligibility.text}`,
        values: [...eligibility.values],
      });
      return result.rows as unknown;
    },
    async measure<Result>(operation: () => Promise<Result>) {
      const startedAt = performance.now();
      const cpuStartedAt = process.cpuUsage();
      const statementStart = statements.length;
      const rowStart = rows.length;
      const result = await operation();
      const [refused] = guarded.refused;
      if (refused !== undefined) throw refused;
      return {
        result,
        elapsedMs: performance.now() - startedAt,
        processCpu: process.cpuUsage(cpuStartedAt),
        statements: statements.slice(statementStart),
        rows: rows.slice(rowStart),
      };
    },
  };
}
