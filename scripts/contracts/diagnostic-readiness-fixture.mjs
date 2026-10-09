// @ts-check
import fs from "node:fs";

/**
 * Publish the fixture's descendant report to the owner's filesystem watcher.
 * @param {string} record
 * @param {string} report
 */
export function publishDescendantReadiness(record, report) {
  const staged = `${record}.pending`;
  fs.writeFileSync(staged, report);
  fs.renameSync(staged, record);
}
