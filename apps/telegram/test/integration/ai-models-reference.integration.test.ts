import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { AiModelsReferences } from "../../src/modules/ai-models/ai-models-reference.js";
import { runAiModelsReferenceImport } from "../../src/operations/ai-models-reference-import-command.js";
import {
  fixedTestInstant,
  registerFixedClock,
  virtualTestClock,
} from "../support/fixed-clock.js";
import { runOwnedCommandSync } from "../support/owned-command.js";
import { required } from "../support/required.js";
import { syntheticAiModelsReference } from "../support/synthetic-ai-models-reference.js";

registerFixedClock();

let database: Database;
let references: AiModelsReferences;

beforeAll(async () => {
  database = createDatabase(required(process.env["DATABASE_URL"]));
  await migrateToLatest(database);
  references = new AiModelsReferences(database, virtualTestClock);
});
beforeEach(async () => {
  await sql`truncate ai_models_references restart identity cascade`.execute(
    database,
  );
});
afterAll(async () => {
  await database.destroy();
});

/** What the synthetic file holds, as every report that accepts it counts it. */
const SYNTHETIC_COUNTS = {
  checkedOn: "2026-11-12",
  services: 4,
  plans: 8,
  models: 9,
  // The first page of «Дёшево», as ai-models-widget-wire.test.ts spells it out.
  largestAnswer: { request: "3lc0", bytes: 603 },
};

describe("Справочник import", () => {
  it("makes the file the current Справочник with the author's opinion apart from the facts", async () => {
    const file = syntheticAiModelsReference();

    const report = await references.import(file, true);

    expect(report).toEqual({
      status: "imported",
      revision: 1,
      ...SYNTHETIC_COUNTS,
    });
    expect(await references.current()).toEqual({
      revision: 1,
      reference: file,
    });
    const stored = await database
      .selectFrom("ai_models_references")
      .select(["facts", "author", "imported_at"])
      .executeTakeFirstOrThrow();
    expect(Object.keys(stored.facts).sort()).toEqual([
      "about",
      "models",
      "plans",
      "services",
    ]);
    expect(stored.author).toEqual(file.author);
    expect(stored.imported_at).toEqual(new Date(fixedTestInstant()));
  });

  it("keeps the earlier revisions and shows the newest one", async () => {
    await references.import(syntheticAiModelsReference(), true);
    const changed = syntheticAiModelsReference();
    changed.checkedOn = "2026-11-19";
    const model = changed.models[0];
    if (model) model.summary = "по-прежнему самая сильная";

    const report = await references.import(changed, true);

    expect(report).toMatchObject({ status: "imported", revision: 2 });
    expect(await references.current()).toEqual({
      revision: 2,
      reference: changed,
    });
    const revisions = await database
      .selectFrom("ai_models_references")
      .select([
        "revision",
        sql<string>`to_char(checked_on, 'YYYY-MM-DD')`.as("checked"),
      ])
      .orderBy("revision")
      .execute();
    expect(revisions).toEqual([
      { revision: 1, checked: "2026-11-12" },
      { revision: 2, checked: "2026-11-19" },
    ]);
  });

  it("reports the same content as unchanged and writes no revision, whatever the spacing and order of keys", async () => {
    await references.import(syntheticAiModelsReference(), true);
    const file = syntheticAiModelsReference();
    const model = file.models[0];
    if (model) model.summary = `  ${model.summary} `;
    const same = {
      ...file,
      author: {
        ...file.author,
        models: Object.fromEntries(
          Object.entries(file.author.models).reverse(),
        ),
      },
    };

    expect(await references.import(same, false)).toEqual({
      status: "unchanged",
      revision: 1,
      ...SYNTHETIC_COUNTS,
    });
    expect(await references.import(same, true)).toEqual({
      status: "unchanged",
      revision: 1,
      ...SYNTHETIC_COUNTS,
    });
    expect(
      await database
        .selectFrom("ai_models_references")
        .select("revision")
        .execute(),
    ).toEqual([{ revision: 1 }]);
  });

  it("makes an earlier file current again as a new revision", async () => {
    const first = syntheticAiModelsReference();
    await references.import(first, true);
    const second = syntheticAiModelsReference();
    second.checkedOn = "2026-11-19";
    await references.import(second, true);

    expect(await references.import(first, true)).toMatchObject({
      status: "imported",
      revision: 3,
    });
    expect(await references.current()).toEqual({
      revision: 3,
      reference: first,
    });
  });

  it("previews the revision an import would write without writing it", async () => {
    expect(
      await references.import(syntheticAiModelsReference(), false),
    ).toEqual({ status: "valid", revision: 1, ...SYNTHETIC_COUNTS });
    expect(await references.current()).toBeUndefined();
  });

  it("rejects a broken file and changes nothing", async () => {
    await references.import(syntheticAiModelsReference(), true);
    const broken = syntheticAiModelsReference();
    Object.assign(broken.models[0] ?? {}, { arenaRank: 2 });

    expect(await references.import(broken, true)).toEqual({
      status: "rejected",
      errors: [
        {
          model: "boreal-2",
          field: "arenaRank",
          reason: "Место 2 в Arena уже занято моделью «atlas-pro».",
        },
      ],
    });
    expect((await references.current())?.revision).toBe(1);
  });
});

describe("Справочник import command", () => {
  const run = (mode: string | undefined, input: string) =>
    runAiModelsReferenceImport({
      mode,
      input,
      database,
      clock: virtualTestClock,
    });

  it("applies a correct file and prints the report as JSON", async () => {
    const result = await run(
      "--apply",
      JSON.stringify(syntheticAiModelsReference()),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      status: "imported",
      revision: 1,
      ...SYNTHETIC_COUNTS,
    });
    expect((await references.current())?.revision).toBe(1);
  });

  it("reports the place and the reason of a rejected file with exit code 2, without its texts", async () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.models[3] ?? {}, { summary: "секрет ".repeat(10) });

    const result = await run("--apply", JSON.stringify(file));

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "rejected",
      errors: [
        { model: "gale", field: "summary", reason: "Знаков 69, лимит 50." },
      ],
    });
    expect(result.stdout).not.toContain("секрет");
    expect(await references.current()).toBeUndefined();
  });

  it.each([
    ["an unknown mode", "--force", "{}"],
    ["no mode", undefined, "{}"],
    ["a file that is not JSON", "--apply", "format: v1"],
  ])(
    "refuses %s with exit code 1 and writes nothing",
    async (_name, mode, input) => {
      const result = await run(mode, input);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(await references.current()).toBeUndefined();
    },
  );
});

describe("Справочник import program", () => {
  it("reads the file from stdin, previews, applies and then reports it unchanged", () => {
    const input = JSON.stringify(syntheticAiModelsReference());
    const cli = (mode: string) => {
      const result = runOwnedCommandSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/operations/ai-models-reference-import-cli.ts",
          mode,
        ],
        { input, encoding: "utf8", env: process.env },
      );
      return {
        status: result.status,
        stderr: result.stderr,
        report: JSON.parse(
          result.stdout === "" ? "null" : result.stdout,
        ) as unknown,
      };
    };

    expect(cli("--preview")).toMatchObject({
      status: 0,
      stderr: "",
      report: { status: "valid", revision: 1 },
    });
    expect(cli("--apply")).toMatchObject({
      status: 0,
      report: { status: "imported", revision: 1 },
    });
    expect(cli("--apply")).toMatchObject({
      status: 0,
      report: { status: "unchanged", revision: 1 },
    });
  }, 60_000);
});
