import {sql,type Kysely} from "kysely";
import type {Migration} from "kysely/migration";
export const learnerActivationMigration:Migration = {
 async up(db:Kysely<unknown>) { await sql`alter table activation_attempts add column source_proof jsonb`.execute(db); },
 async down(db:Kysely<unknown>) { await sql`alter table activation_attempts drop column source_proof`.execute(db); },
};
