import { Prisma } from "./prisma/index.js";
export const metadata = Prisma.sql`select id from accounts.accounts; select name from pgboss.queue`;
