import { PrismaClient } from "../../../src/infrastructure/prisma/generated/client.js";
import { createPrismaPgAdapter } from "../../../src/infrastructure/prisma/prisma-adapter.js";

/** Own this client alongside the test database; seed before measure() starts. */
import { guardTransactionConnections } from "./transaction-guard.js";

export function createQueryEventClient(connectionString: string) {
  const statements: string[] = [];
  const prisma = new PrismaClient({
    adapter: createPrismaPgAdapter(connectionString),
    log: [{ emit: "event", level: "query" }],
  });
  prisma.$on("query", (event) => statements.push(event.query));
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
