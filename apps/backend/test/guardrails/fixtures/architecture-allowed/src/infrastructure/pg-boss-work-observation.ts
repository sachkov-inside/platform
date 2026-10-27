import { Prisma } from "../../../../../../src/infrastructure/prisma/index.js";
export const metadata = Prisma.sql`select id from pgboss.job; select queue_name from queue_observation.last_successful_handler`;
