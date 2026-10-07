// @ts-check
import { mkdir, readFile, open, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { canonical, checksum } from "./package.mjs";
import { isJournalOperation, parseJournal } from "./local-boundaries.mjs";

/**
 * @typedef {ReturnType<typeof parseJournal>} Journal
 * @typedef {{ journal: Journal; persist: () => Promise<void> }} JournalContext
 */

/**
 * @param {string} path
 * @param {unknown} value
 */
export async function writeAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${canonical(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

/**
 * One serial writer per environment; credentials and media bytes never enter the journal.
 *
 * @template T
 * @param {string} directory
 * @param {string} target
 * @param {(context: JournalContext) => T | Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function withJournal(directory, target, operation) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, {
    retries: 0,
    stale: 120_000,
    update: 10_000,
  });
  try {
    const path = join(root, "journal.json");
    /** @type {Journal} */
    let journal;
    try {
      journal = parseJournal(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      journal = {
        schemaVersion: 1,
        target,
        materials: {},
        products: {},
        operations: {},
      };
    }
    if (journal.schemaVersion !== 1 || journal.target !== target)
      throw new Error("Journal belongs to another environment");
    const persist = () => writeAtomic(path, journal);
    await persist();
    return await operation({ journal, persist });
  } finally {
    await release();
  }
}

/**
 * The key is the checksum of the canonical request, so an entry under it holds the same request.
 *
 * @template R
 * @param {unknown} stored
 * @param {R} request
 * @returns {stored is R}
 */
function isSameRequest(stored, request) {
  return canonical(stored) === canonical(request);
}

/**
 * Persist the exact request before transmission; uncertain retries reuse its key and bytes.
 *
 * @template R
 * @param {JournalContext} context
 * @param {R} request
 * @param {(request: R, key: string) => Promise<unknown>} send
 * @returns {Promise<unknown>}
 */
export async function applyJournaled({ journal, persist }, request, send) {
  const key = `authoring:${checksum(canonical(request))}`;
  let entry = journal.operations[key];
  if (entry !== undefined && !isJournalOperation(entry))
    throw new Error("Journal entry is not a request operation");
  if (entry?.status === "applied") return entry.result;
  if (entry?.status === "rejected")
    throw Object.assign(new Error(entry.error.message), {
      status: entry.error.status,
    });
  if (!entry) {
    entry = { request, status: "pending" };
    journal.operations[key] = entry;
    await persist();
  }
  const sent = entry.request;
  if (!isSameRequest(sent, request))
    throw new Error("Journal request fingerprint mismatch");
  let result;
  try {
    result = await send(sent, key);
  } catch (error) {
    // A definitive client rejection did not commit; do not replay it ahead of corrected inputs.
    if (
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500 &&
      // A timeout, throttling or an expired sign-in says nothing about the request itself: after a
      // renewed sign-in the same request is sent again. 403 stays definitive (#805).
      ![401, 408, 429].includes(error.status)
    ) {
      journal.operations[key] = {
        ...entry,
        status: "rejected",
        error: { status: error.status, message: error.message },
      };
      await persist();
    }
    throw error;
  }
  journal.operations[key] = { ...entry, status: "applied", result };
  await persist();
  return result;
}
