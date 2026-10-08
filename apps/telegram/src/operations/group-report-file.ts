import { open } from "node:fs/promises";
import type { collectGroupMembersReport } from "../modules/community/group-members-report.js";

/** Exclusive owner-only output. Never overwrite a previous report or follow a symlink. */
export async function saveGroupMembersReport(
  path: string,
  report: Awaited<ReturnType<typeof collectGroupMembersReport>>,
): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(report, null, 2) + "\n");
  } finally {
    await file.close();
  }
}
