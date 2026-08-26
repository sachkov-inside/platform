import { defineConfig } from "prisma/config";

const localDatabaseUrl = "postgresql://inside:inside@127.0.0.1:5432/inside";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
});
