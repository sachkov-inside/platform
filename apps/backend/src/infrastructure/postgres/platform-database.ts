import type { Kysely } from "kysely";

import type { DB } from "./generated/database.js";

export type PlatformDatabase = Kysely<DB>;

export const PLATFORM_DATABASE = Symbol("PLATFORM_DATABASE");
