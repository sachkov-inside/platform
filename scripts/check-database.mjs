// @ts-check
import { execFileSync } from "node:child_process";
import process from "node:process";

// The owner's stand keeps database `inside`. Host checks that migrate, seed and bootstrap owners use
// this separate database on the same Compose PostgreSQL, so they never rewrite the stand's content.
export const checkDatabaseName = "inside_checks";

// `compose.yaml` names the stand project; Docker Compose lets `COMPOSE_PROJECT_NAME` override it, so a
// check started for another project must reach that project's PostgreSQL, not the stand's (#757).
const standComposeProject = "inside-platform";

/**
 * @typedef {(
 *   file: string,
 *   args: string[],
 *   options: { cwd: string | undefined; encoding: "utf8" },
 * ) => string} RunCommand
 * @typedef {object} CheckDatabaseOptions
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [environment]
 * @property {string} [composeProject]
 * @property {RunCommand} [run]
 */

/**
 * The Compose project a plain `docker compose` command in this repository would use.
 * @param {NodeJS.ProcessEnv} environment
 */
function composeProjectName(environment) {
  const named = environment["COMPOSE_PROJECT_NAME"]?.trim();
  return named === undefined || named === "" ? standComposeProject : named;
}

/** @param {number | string} [port] */
export function checkDatabaseUrl(port = 5432) {
  return `postgresql://inside:inside@127.0.0.1:${String(port)}/${checkDatabaseName}`;
}

/** @param {CheckDatabaseOptions} [options] */
export function ensureCheckDatabase({
  cwd,
  environment = process.env,
  composeProject = composeProjectName(environment),
  run = execFileSync,
} = {}) {
  const psql = checkPsql({ cwd, composeProject, run });
  if (
    psql(`select 1 from pg_database where datname = '${checkDatabaseName}'`) !==
    "1"
  ) {
    psql(`create database ${checkDatabaseName}`);
  }
}

// A run that asserts on seeded content starts from an empty check database: materials, products and
// buyers left by earlier runs would otherwise change what the next run sees.
/** @param {CheckDatabaseOptions} [options] */
export function resetCheckDatabase({
  cwd,
  environment = process.env,
  composeProject = composeProjectName(environment),
  run = execFileSync,
} = {}) {
  const psql = checkPsql({ cwd, composeProject, run });
  psql(`drop database if exists ${checkDatabaseName} with (force)`);
  psql(`create database ${checkDatabaseName}`);
}

/**
 * @param {{ cwd: string | undefined; composeProject: string; run: RunCommand }} options
 * @returns {(sql: string) => string}
 */
function checkPsql({ cwd, composeProject, run }) {
  return (sql) => {
    try {
      return run(
        "docker",
        [
          "compose",
          "--project-name",
          composeProject,
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U",
          "inside",
          "-d",
          "inside",
          "-Atc",
          sql,
        ],
        { cwd, encoding: "utf8" },
      ).trim();
    } catch (error) {
      throw new Error(
        `Compose PostgreSQL of ${composeProject} is not reachable; start it before this check`,
        { cause: error },
      );
    }
  };
}
