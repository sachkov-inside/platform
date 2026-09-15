import { mkdir, readFile, open, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { canonical, checksum } from "./package.mjs";

export async function writeAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try { await handle.writeFile(`${canonical(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}

/** One serial writer per environment; credentials and media bytes never enter the journal. */
export async function withJournal(directory, target, operation) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, { retries: 0, stale: 120_000, update: 10_000 });
  try {
    const path = join(root, "journal.json");
    let journal;
    try { journal = JSON.parse(await readFile(path, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      journal = { schemaVersion: 1, target, materials: {}, guides: {}, operations: {} };
    }
    if (journal.schemaVersion !== 1 || journal.target !== target) throw new Error("Journal belongs to another environment");
    const persist = () => writeAtomic(path, journal);
    await persist();
    return await operation({ journal, persist });
  } finally { await release(); }
}

/** Persist the exact request before transmission; uncertain retries reuse its key and bytes. */
export async function applyJournaled({ journal, persist }, request, send) {
  const key = `authoring:${checksum(canonical(request))}`;
  let entry = journal.operations[key];
  if (entry?.status === "applied") return entry.result;
  if (entry?.status === "rejected") throw Object.assign(new Error(entry.error.message), { status: entry.error.status });
  if (!entry) {
    entry = { request, status: "pending" };
    journal.operations[key] = entry;
    await persist();
  }
  let result;
  try { result = await send(entry.request, key); }
  catch (error) {
    // A definitive client rejection did not commit; do not replay it ahead of corrected inputs.
    if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
      entry.status = "rejected";
      entry.error = { status: error.status, message: error.message };
      await persist();
    }
    throw error;
  }
  entry.status = "applied";
  entry.result = result;
  await persist();
  return result;
}
