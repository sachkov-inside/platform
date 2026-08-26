import { PrismaPg } from "@prisma/adapter-pg";

const databasePoolPolicy = {
  max: 10,
  connectionTimeoutMillis: 5_000,
} as const;

export function createPrismaPgAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({
    connectionString,
    ...databasePoolPolicy,
  });
}
