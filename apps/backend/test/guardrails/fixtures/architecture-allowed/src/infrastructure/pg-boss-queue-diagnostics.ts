import { Prisma } from "../../../../../../src/infrastructure/prisma/index.js";
export const metadata = Prisma.sql`select version from pgboss.version; select name from pgboss.queue; select state from pgboss.job`;
