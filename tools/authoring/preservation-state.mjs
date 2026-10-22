// @ts-check
import { createRequire } from "node:module";
import { z } from "zod";

const access = z.enum(["free", "closed"]);
export const targetStateSchema = z
  .object({
    materials: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          materialId: z.uuid(),
          contentVersion: z.number().int().positive(),
          access,
          publicationState: z.enum(["draft", "published", "unpublished"]),
        })
        .strict(),
    ),
    tasks: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          taskId: z.uuid(),
          code: z.string().min(1),
          productId: z.uuid(),
          chapterId: z.uuid().optional(),
          position: z.number().int().positive().optional(),
          afterMaterialSourceId: z.string().nullable().optional(),
          programmeVisibility: z
            .enum(["standalone", "embedded", "legacy"])
            .optional(),
          embeddedMaterialId: z.uuid().nullable().optional(),
          revision: z.number().int().positive(),
          access,
          publicationState: z.enum(["published", "unpublished"]),
        })
        .strict(),
    ),
  })
  .strict();

/** @typedef {z.infer<typeof targetStateSchema>} TargetState */
/** @typedef {(materialIds: string[], taskIds: string[]) => Promise<TargetState>} ReadTargetState */

/** PostgreSQL access is deliberately restricted to the local stand.
 * @param {string} databaseUrl */
export function localPreservationDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    url.pathname !== "/inside"
  )
    throw new Error(
      "Preservation requires a loopback PostgreSQL inside database without URL options",
    );
  return databaseUrl;
}

/** A bounded read-only transaction; no reader/account/submission tables are inspected.
 * @param {string} databaseUrl
 * @param {(options: { connectionString: string; connectionTimeoutMillis: number }) => import('../../apps/backend/test/support/proof-dependencies.js').Client} [createClient]
 * @returns {ReadTargetState} */
export function postgresPreservationState(databaseUrl, createClient) {
  localPreservationDatabase(databaseUrl);
  return async (materialIds, taskIds) => {
    const factory =
      createClient ??
      ((options) => {
        const require = createRequire(
          new URL("../../apps/backend/package.json", import.meta.url),
        );
        // oxlint-disable typescript/no-unsafe-type-assertion
        const pg =
          /** @type {typeof import('../../apps/backend/test/support/proof-dependencies.js')} */ (
            require("pg")
          );
        // oxlint-enable typescript/no-unsafe-type-assertion
        return new pg.Client(options);
      });
    const client = factory({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      await client.query("SET LOCAL statement_timeout = '10s'");
      const materials = await client.query(
        `SELECT source_id AS "sourceId", id AS "materialId",
        content_version::integer AS "contentVersion", access, publication_state AS "publicationState"
        FROM materials.materials WHERE source_id = ANY($1::text[]) ORDER BY source_id`,
        [materialIds],
      );
      const tasks = await client.query(
        `SELECT source_id AS "sourceId", id AS "taskId", code,
        product_id AS "productId", chapter_id AS "chapterId", position,
        after_material_source_id AS "afterMaterialSourceId", programme_visibility AS "programmeVisibility",
        embedded_material_id AS "embeddedMaterialId", revision, access, publication_state AS "publicationState"
        FROM product_tasks.tasks WHERE source_id = ANY($1::text[]) OR code = ANY($2::text[]) ORDER BY source_id`,
        [taskIds, taskIds.map((id) => id.slice(id.indexOf(":") + 1))],
      );
      await client.query("COMMIT");
      return targetStateSchema.parse({
        materials: materials.rows,
        tasks: tasks.rows,
      });
    } finally {
      await client.end();
    }
  };
}
