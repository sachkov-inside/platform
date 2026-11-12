import { createHash } from "node:crypto";

import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import type { Clock } from "../../shared/clock.js";
import {
  aiModelsAnswerSizes,
  aiModelsReferenceFileSchema,
  readAiModelsReferenceFile,
  type AiModelsAnswerSize,
  type AiModelsReference,
  type AiModelsReferenceError,
} from "./ai-models-reference-file.js";

/** What an accepted file holds. The report carries no text of the file. */
export interface AiModelsReferenceSummary {
  readonly checkedOn: string;
  readonly services: number;
  readonly plans: number;
  readonly models: number;
  /** The largest answer the widget can get from this Справочник. */
  readonly largestAnswer: AiModelsAnswerSize;
}

export type AiModelsReferenceImportReport =
  | {
      readonly status: "rejected";
      readonly errors: readonly AiModelsReferenceError[];
    }
  | ({
      /**
       * `valid`: a preview; `--apply` would write `revision`. `imported`: `revision` is the
       * current Справочник now. `unchanged`: the current revision already holds this content,
       * so nothing is written.
       */
      readonly status: "valid" | "imported" | "unchanged";
      readonly revision: number;
    } & AiModelsReferenceSummary);

/** The current Справочник and its revision. */
export interface StoredAiModelsReference {
  readonly revision: number;
  readonly reference: AiModelsReference;
}

/**
 * The Справочник of the ИИ-модели section: the owner's import and the read of the current one.
 * Every import that changes the content adds a revision; the highest one is current and the
 * earlier ones stay as history.
 */
export class AiModelsReferences {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Checks the whole file first; a rejected file changes nothing. With `apply` the file then
   * becomes the current Справочник in one transaction, unless the current one has the same
   * content.
   */
  async import(
    input: unknown,
    apply: boolean,
  ): Promise<AiModelsReferenceImportReport> {
    const file = readAiModelsReferenceFile(input);
    if (file.status === "rejected") return file;
    const { reference } = file;
    const summary = summarize(reference);
    const digest = contentDigest(reference);

    return this.db.transaction().execute(async (tx) => {
      // Two imports at once would both take the same next revision.
      await sql`select pg_advisory_xact_lock(hashtextextended('ai-models-reference-import', 0))`.execute(
        tx,
      );
      const current = await tx
        .selectFrom("ai_models_references")
        .select(["revision", "content_sha256"])
        .orderBy("revision", "desc")
        .limit(1)
        .executeTakeFirst();
      if (current?.content_sha256 === digest)
        return {
          status: "unchanged",
          revision: current.revision,
          ...summary,
        } as const;
      const revision = (current?.revision ?? 0) + 1;
      if (!apply) return { status: "valid", revision, ...summary } as const;

      const { checkedOn, author, about, services, plans, models } = reference;
      await tx
        .insertInto("ai_models_references")
        .values({
          revision,
          checked_on: checkedOn,
          facts: JSON.stringify({ about, services, plans, models }),
          author: JSON.stringify(author),
          content_sha256: digest,
          imported_at: this.clock.now(),
        })
        .execute();
      return { status: "imported", revision, ...summary } as const;
    });
  }

  /** The Справочник people see; `undefined` before the first import. */
  async current(): Promise<StoredAiModelsReference | undefined> {
    const row = await this.db
      .selectFrom("ai_models_references")
      .select([
        "revision",
        sql<string>`to_char(checked_on, 'YYYY-MM-DD')`.as("checked_on"),
        "facts",
        "author",
      ])
      .orderBy("revision", "desc")
      .limit(1)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    // The import checked every rule; this read restores the types and the format mark.
    const reference = aiModelsReferenceFileSchema.parse({
      format: "inside.ai-models-reference.v1",
      checkedOn: row.checked_on,
      ...row.facts,
      author: row.author,
    });
    return { revision: row.revision, reference };
  }
}

function summarize(reference: AiModelsReference): AiModelsReferenceSummary {
  const [largestAnswer] = aiModelsAnswerSizes(reference).sort(
    (a, b) => b.bytes - a.bytes,
  );
  if (largestAnswer === undefined)
    throw new Error("A Справочник always has «О данных»");
  return {
    checkedOn: reference.checkedOn,
    services: reference.services.length,
    plans: reference.plans.length,
    models: reference.models.length,
    largestAnswer,
  };
}

/**
 * SHA-256 of the Справочник's content: the checked file with object keys in a fixed order, so
 * spacing, key order and the order of the author's entries do not make a new revision.
 */
function contentDigest(reference: AiModelsReference): string {
  return createHash("sha256").update(canonicalJson(reference)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
