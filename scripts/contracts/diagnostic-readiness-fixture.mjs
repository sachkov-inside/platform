// @ts-check
import fs from "node:fs";
import { createInterface } from "node:readline";

/**
 * Publish the fixture's descendant report to the owner's filesystem watcher.
 * @param {string} record
 * @param {string} report
 * @param {number} publisherPid
 */
export function publishDescendantReadiness(record, report, publisherPid) {
  /** @type {unknown} */
  const tree = JSON.parse(report);
  if (typeof tree !== "object" || tree === null)
    throw new Error("Expected a descendant JSON report");
  const staged = `${record}.${publisherPid}.pending`;
  fs.writeFileSync(staged, report);
  fs.renameSync(staged, record);
}

/**
 * Forward the descendant's stdout report to the owner's readiness watcher.
 * @param {import("node:stream").Readable} stdout
 * @param {string} record
 * @param {() => void} ready
 */
export function reportDescendantReadiness(stdout, record, ready) {
  const lines = createInterface({ input: stdout });
  lines.once("line", (report) => {
    lines.close();
    publishDescendantReadiness(record, report, process.pid);
    ready();
  });
}
