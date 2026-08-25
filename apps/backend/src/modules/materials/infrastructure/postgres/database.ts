import type { Kysely, Transaction } from "kysely";

import type { DB } from "../../../../infrastructure/postgres/generated/database.js";

type MaterialsDB = Pick<DB, Extract<keyof DB, `materials.${string}`>>;

export type AuthoringDatabase = Kysely<MaterialsDB>;
export type AuthoringTransaction = Transaction<MaterialsDB>;
