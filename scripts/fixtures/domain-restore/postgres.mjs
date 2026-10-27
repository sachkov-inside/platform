import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";

const dockerCommandFailureMilliseconds = 60_000;
const postgresReadinessFailureMilliseconds = 30_000;
const lifetimeHandshakeFailureMilliseconds = 10_000;
const postgresDestructionFailureMilliseconds = 15_000;
const execute = promisify(execFile);
export const restorePostgresImage =
  "ghcr.io/sachkov-inside/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";

/** Synthetic, isolated databases only. Archives and tools live in this check's container. */
export async function createRestorePostgres(owner, options = {}) {
  const name = options.containerName ?? `inside-mixed-restore-${randomUUID()}`;
  if (!/^inside-mixed-restore-[a-f0-9-]{36}$/u.test(name))
    throw new Error("Invalid owned restore container name");
  const commands = [];
  const databases = new Set();
  const archives = new Set();
  let acquired = false;
  let lease;
  let containerId;
  const evidence = { owner, image: restorePostgresImage, commands };
  const pending = new Set();
  let closing = false;
  async function docker(args) {
    if (closing && !["rm", "container"].includes(args[0]))
      throw new Error("Restore fixture is closing");
    const operation = execute("docker", args, {
      timeout: dockerCommandFailureMilliseconds,
      maxBuffer: 16 * 1024 * 1024,
    });
    pending.add(operation);
    try {
      const result = await operation;
      commands.push({ args, exitCode: 0 });
      return result.stdout.trim();
    } catch (error) {
      commands.push({ args, exitCode: error.code ?? "signal" });
      throw error;
    } finally {
      pending.delete(operation);
    }
  }
  async function tool(args) {
    return docker(["exec", name, ...args]);
  }
  async function close() {
    if (!acquired) return;
    closing = true;
    await Promise.allSettled([...pending]);
    if (options.daemonLifetime && lease) {
      lease.end();
      const deadline = Date.now() + postgresDestructionFailureMilliseconds;
      while (true) {
        try {
          await docker(["container", "inspect", containerId]);
        } catch (error) {
          if (!String(error.stderr).includes("No such container")) throw error;
          break;
        }
        if (Date.now() >= deadline)
          throw new Error(
            "Owned PostgreSQL destruction failure budget exceeded",
          );
        await setTimeout(25);
      }
      evidence.containerAbsent = true;
    } else await docker(["rm", "--force", "--volumes", name]);
    acquired = false;
    const evidenceDirectory = process.env["DOMAIN_RESTORE_EVIDENCE_DIRECTORY"];
    if (evidenceDirectory !== undefined) {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(
        join(evidenceDirectory, `${owner}.json`),
        JSON.stringify(evidence, null, 2),
      );
    }
  }
  try {
    acquired = true;
    const runArguments = [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      `inside.mixed-restore.owner=${owner}`,
      "--publish",
      "127.0.0.1::5432",
      "--tmpfs",
      "/var/lib/postgresql:rw,size=512m",
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
    ];
    if (options.daemonLifetime) {
      const lifetimeScript = fileURLToPath(
        new URL("./postgres-lifetime.sh", import.meta.url),
      );
      runArguments.push(
        "--rm",
        "--publish",
        "127.0.0.1::55432",
        "--env",
        `RESTORE_LEASE_NAME=${name}`,
        "--mount",
        `type=bind,source=${lifetimeScript},target=/postgres-lifetime.sh,readonly`,
        "--mount",
        `type=bind,source=${options.daemonLifetime},target=/evidence`,
        "--entrypoint",
        "sh",
        restorePostgresImage,
        "/postgres-lifetime.sh",
      );
    } else runArguments.push(restorePostgresImage);
    containerId = await docker(runArguments);
    if (options.daemonLifetime) {
      options.onContainerAcquired?.({ name, containerId });
      const binding = await docker(["port", name, "55432/tcp"]);
      if (!/^127\.0\.0\.1:\d+$/u.test(binding))
        throw new Error("Unexpected owned lifetime binding");
      const deadline = Date.now() + lifetimeHandshakeFailureMilliseconds;
      while (!lease) {
        try {
          lease = await new Promise((ready, reject) => {
            const connection = createConnection({
              host: "127.0.0.1",
              port: Number(binding.split(":")[1]),
            });
            connection.setTimeout(lifetimeHandshakeFailureMilliseconds);
            connection.once("error", reject);
            connection.once("timeout", () => {
              connection.destroy();
              reject(new Error("Lifetime handshake failure budget exceeded"));
            });
            connection.once("data", (data) => {
              if (data.toString() !== "LEASE_READY\n") {
                connection.destroy();
                reject(new Error("Invalid lifetime handshake"));
                return;
              }
              connection.setTimeout(0);
              ready(connection);
            });
          });
        } catch (error) {
          if (Date.now() >= deadline || error.code !== "ECONNREFUSED")
            throw error;
          await setTimeout(25);
        }
      }
    }
    acquired = true;
    const deadline = Date.now() + postgresReadinessFailureMilliseconds;
    while (
      (await tool([
        "pg_isready",
        "--host=127.0.0.1",
        "--username=postgres",
      ]).catch(() => "")) !== "127.0.0.1:5432 - accepting connections"
    ) {
      if (Date.now() >= deadline)
        throw new Error("Owned PostgreSQL did not become ready");
      await setTimeout(100);
    }
    const port = await docker(["port", name, "5432/tcp"]);
    if (!/^127\.0\.0\.1:\d+$/u.test(port))
      throw new Error("Unexpected owned PostgreSQL binding");
    const versions = {
      server: await tool([
        "psql",
        "-U",
        "postgres",
        "-Atc",
        "show server_version",
      ]),
      dump: await tool(["pg_dump", "--version"]),
      restore: await tool(["pg_restore", "--version"]),
    };
    evidence.versions = versions;
    return {
      evidence,
      image: restorePostgresImage,
      versions,
      commands,
      async emptyDatabase() {
        const database = `restore_${randomUUID().replaceAll("-", "")}`;
        await tool(["createdb", "--username=postgres", database]);
        databases.add(database);
        return {
          name: database,
          url: `postgresql://postgres@${port}/${database}`,
        };
      },
      async backup(database) {
        if (!databases.has(database.name))
          throw new Error("Backup database is not owned");
        const path = `/tmp/${randomUUID()}.dump`;
        await tool([
          "pg_dump",
          "--username=postgres",
          "--format=custom",
          "--no-owner",
          "--no-acl",
          `--file=${path}`,
          `--dbname=${database.name}`,
        ]);
        archives.add(path);
        const listing = await tool(["pg_restore", "--list", path]);
        if (!listing.includes("TABLE DATA") || !listing.includes("TABLE "))
          throw new Error("Expected a full archive");
        return {
          path,
          sha256: (await tool(["sha256sum", path])).split(" ")[0],
          bytes: Number(await tool(["stat", "-c", "%s", path])),
          listing,
        };
      },
      async restore(archive, destination) {
        if (!archives.has(archive.path) || !databases.has(destination.name))
          throw new Error("Restore resources are not owned");
        const count = await tool([
          "psql",
          "--username=postgres",
          `--dbname=${destination.name}`,
          "-Atc",
          "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','S')",
        ]);
        if (count !== "0")
          throw new Error("Restore destination must be completely empty");
        await tool([
          "pg_restore",
          "--username=postgres",
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--no-acl",
          `--dbname=${destination.name}`,
          archive.path,
        ]);
      },
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Restore PostgreSQL acquisition and cleanup failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

/** Exact relational state, including immutable receipts and the application's real ledger. */
export async function snapshotDatabase(query) {
  const tables = await query(
    "select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by schemaname,tablename",
  );
  const snapshot = {};
  const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
  for (const { schemaname, tablename } of tables.rows) {
    const rows = await query(
      `select to_jsonb(row_value)::text as value from ${quoted(schemaname)}.${quoted(tablename)} row_value order by to_jsonb(row_value)::text`,
    );
    snapshot[`${schemaname}.${tablename}`] = rows.rows.map(
      ({ value }) => value,
    );
  }
  const sequences = await query(
    "select schemaname,sequencename,last_value from pg_sequences where schemaname not in ('pg_catalog','information_schema') order by schemaname,sequencename",
  );
  return { tables: snapshot, sequences: sequences.rows };
}
