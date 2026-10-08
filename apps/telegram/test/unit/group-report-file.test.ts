import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { saveGroupMembersReport } from "../../src/operations/group-report-file.js";

it("writes an operator-only report and refuses existing paths and symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-group-report-"));
  try {
    const path = join(directory, "report.json");
    const report = {
      startedAt: "2026-10-08T10:00:00Z",
      completedAt: "2026-10-08T10:00:01Z",
      coverage: "known_ids_only" as const,
      platformCheckedAt: "2026-10-08T10:00:00Z",
      platformTruncated: false,
      candidatesChecked: 0,
      notMembers: 0,
      items: [],
    };
    await saveGroupMembersReport(path, report);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toContain('"known_ids_only"');
    await expect(saveGroupMembersReport(path, report)).rejects.toThrow();
    const target = join(directory, "target");
    const link = join(directory, "link");
    await writeFile(target, "keep");
    await symlink(target, link);
    await expect(saveGroupMembersReport(link, report)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
