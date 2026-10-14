import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../src/infrastructure/prisma/generated/client.js";
import { guardTransactionConnections } from "./transaction-guard.js";

/** Observe real driver statements, including BEGIN/COMMIT that Prisma query events omit. */
export function createQueryProtocolClient(connectionString: string) {
  const statements: string[] = [];
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on("connect", (client) => {
    client.query = new Proxy(client.query.bind(client), {
      apply(target, receiver: unknown, args: unknown[]) {
        const input = args[0];
        if (typeof input === "string") statements.push(input);
        else if (
          typeof input === "object" &&
          input !== null &&
          "text" in input &&
          typeof input.text === "string"
        )
          statements.push(input.text);
        const result: unknown = Reflect.apply(target, receiver, args);
        return result;
      },
    });
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  });
  const guarded = guardTransactionConnections(prisma);
  return {
    prisma: guarded.prisma,
    async measure<Result>(operation: () => Promise<Result>) {
      const start = statements.length;
      const result = await operation();
      const [refused] = guarded.refused;
      if (refused !== undefined) throw refused;
      return { result, statements: statements.slice(start) };
    },
  };
}
