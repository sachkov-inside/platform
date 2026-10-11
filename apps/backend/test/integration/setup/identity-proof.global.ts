import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import { z } from "zod";

import { readMiniAppIdentityProofContext } from "../../../../../scripts/mini-app-identity-proof.mjs";
import { migrateToLatest } from "../../../src/migrations/index.js";

// Existing TestDatabase owns each case database. This setup owns only its migrated template.
const templateName = "inside_461_migrated_template";

export default async function setup(project: Pick<TestProject, "provide">) {
  const contextPath = process.env["IDENTITY_PROOF_ISOLATED_CONTEXT"];
  if (contextPath === undefined)
    throw new Error("#461 own PG context is required");
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../..",
  );
  const context = readMiniAppIdentityProofContext(contextPath, root);
  const admin = new Pool({
    connectionString: context.platformDatabaseUrl,
    max: 1,
  });
  let created = false;
  try {
    // Fail before any CREATE/MIGRATE unless this fresh cluster has our bootstrap marker.
    z.object({
      rows: z
        .array(z.object({ session: z.literal(context.session) }))
        .length(1),
    }).parse(await admin.query("SELECT session FROM proof_461.owner"));
    await admin.query(`CREATE DATABASE ${templateName}`);
    created = true;
    const templateUrl = new URL(context.platformDatabaseUrl);
    templateUrl.pathname = `/${templateName}`;
    await migrateToLatest(templateUrl.toString());
    await admin.query(
      `ALTER DATABASE ${templateName} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`,
    );
    project.provide("postgresAdminUrl", context.platformDatabaseUrl);
    project.provide("postgresMigratedTemplate", templateName);
  } catch (error) {
    if (created) {
      try {
        await admin.query(`DROP DATABASE ${templateName}`);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "#461 PG setup failed; template cleanup also failed",
          { cause: cleanupError },
        );
      }
    }
    throw error;
  } finally {
    await admin.end();
  }
  return async () => {
    const cleanup = new Pool({
      connectionString: context.platformDatabaseUrl,
      max: 1,
    });
    try {
      await cleanup.query(`DROP DATABASE ${templateName}`);
    } finally {
      await cleanup.end();
    }
  };
}
