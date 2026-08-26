import type { Kysely } from "kysely";
import type { Pool } from "pg";

export type ForbiddenPersistence = Kysely<unknown> | Pool;

declare const Prisma: {
  sql(parts: TemplateStringsArray): unknown;
  raw(value: string): unknown;
};

Prisma.sql`select * from materials`;
Prisma.sql`select * from "accounts"."accounts"`;

const dynamicTable = "accounts.accounts";
Prisma.sql`select * from ${dynamicTable}`;
Prisma.raw(dynamicTable);
