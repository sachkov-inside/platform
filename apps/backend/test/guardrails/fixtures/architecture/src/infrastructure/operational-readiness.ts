import type { Pool } from "pg";
import { Prisma } from "./prisma/index.js";

export type ForbiddenReadinessPool = Pool;

export const forbiddenAccountRead = Prisma.sql`select id from accounts.accounts`;
