import type { Kysely, Transaction } from "kysely";

import type { DB } from "../../../../infrastructure/postgres/generated/database.js";

export type AuthoringDatabase = Kysely<DB>;
export type AuthoringTransaction = Transaction<DB>;
