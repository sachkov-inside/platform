import { execFileSync } from "node:child_process";

// The owner's stand keeps database `inside`. Host checks that migrate, seed and bootstrap owners use
// this separate database on the same Compose PostgreSQL, so they never rewrite the stand's content.
export const checkDatabaseName = "inside_checks";

export function checkDatabaseUrl(port = 5432) {
  return `postgresql://inside:inside@127.0.0.1:${String(port)}/${checkDatabaseName}`;
}

export function ensureCheckDatabase({ cwd, composeProject = "inside-platform", run = execFileSync } = {}) {
  const psql = (sql) => run("docker", ["compose", "--project-name", composeProject, "exec", "-T", "postgres", "psql", "-U", "inside", "-d", "inside", "-Atc", sql], { cwd, encoding: "utf8" }).trim();
  if (psql(`select 1 from pg_database where datname = '${checkDatabaseName}'`) !== "1") {
    psql(`create database ${checkDatabaseName}`);
  }
}
