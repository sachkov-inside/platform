import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { expect, it } from "vitest";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import {
  parseAuthorState,
  resolveAuthorCallback,
} from "../../src/modules/communications/author-dialog.js";
import { transition } from "../../src/modules/communications/author-transition.js";
import { withMigrationDatabase } from "../support/migration-database.js";
import { required } from "../support/required.js";

it("upgrades an active historical batch dialog without resetting its draft or changing original archived state", async () => {
  await withMigrationDatabase(
    required(process.env["DATABASE_URL"]),
    `author_contract_${randomUUID().replaceAll("-", "")}`,
    async (database) => {
      await migrateTo(database, "036-material-announcements");
      const original = {
        version: 1,
        token: "preserved-token",
        actions: [{ kind: "batch:done" }],
        batch: "funnel",
        libraryQuery: "funnel is authored search text",
        funnelAuthor: {
          target: "entry",
          dirty: true,
          funnel: {
            funnelId: randomUUID(),
            name: "Preserved draft",
            isDefault: false,
            revision: 3,
            publishedRevision: 2,
            lifecycle: "published",
            sources: [],
            steps: [],
            entryResponse: { stepId: randomUUID(), parts: [] },
          },
        },
      };
      await sql`insert into communication_author_sessions(bot_identity,telegram_user_id,account_ref,state) values('fixture',42,'author',${JSON.stringify(original)}::jsonb)`.execute(
        database,
      );
      await migrateToLatest(database);
      const row = await database
        .selectFrom("communication_author_sessions")
        .select("state")
        .executeTakeFirstOrThrow();
      const state = parseAuthorState(row.state);
      expect(state?.batch).toBe("sequence");
      if (!state) throw new Error("Active dialog must remain resumable");
      expect(state.token).toBe(original.token);
      expect(resolveAuthorCallback(state, "author:preserved-token:0")).toEqual({
        kind: "batch:done",
      });
      const content = {
        type: "text",
        text: "Next message",
        entities: [],
        buttons: [],
      };
      const resumed = transition(
        state,
        { kind: "text", text: content.text, content },
        {
          now: new Date("2026-10-24T05:00:00Z"),
          newId: randomUUID,
          pendingCompositions: new Set(),
        },
      );
      expect(resumed.state.batch).toBe("sequence");
      expect(
        resumed.state.sequenceAuthor?.sequence?.entryResponse.parts,
      ).toMatchObject([{ content }]);
      expect(resumed.state.libraryQuery).toBe(original.libraryQuery);
      const archive = await sql<{
        original: { state: unknown };
      }>`select original from communication_historical_author_state where source_table='communication_author_sessions'`.execute(
        database,
      );
      expect(archive.rows[0]?.original.state).toEqual(original);
    },
  );
});
