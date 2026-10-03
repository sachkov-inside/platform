import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { removeLeftoverSnapshots } from "../../src/modules/course-assistant/features/run-practice-review/run-practice-review.js";
import { openRepositorySnapshot } from "../../src/modules/course-assistant/infrastructure/snapshot/repository-snapshot.js";
import { repositoryArchive } from "../fixtures/course-assistant-repositories.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function root() {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-test-"));
  roots.push(directory);
  return directory;
}

describe("repository snapshot", () => {
  test("reads files by range, lists the tree and searches text", async () => {
    const brief =
      "# Бриф\nУчастник создаёт заявку.\nЧужой участник не видит заявку.\n";
    const archive = await repositoryArchive({
      "docs/brief.md": brief,
      "src/app.mjs": "export const answer = 42;\n",
      "logo.png": Buffer.from([0, 1, 2, 3]),
    });
    const snapshot = await openRepositorySnapshot(archive, await root());
    if (!snapshot.ok) throw new Error(snapshot.reason);

    expect(snapshot.value.listFiles("")).toEqual({
      files: [
        { path: "docs/brief.md", bytes: Buffer.byteLength(brief) },
        { path: "logo.png", bytes: 4 },
        { path: "src/app.mjs", bytes: 26 },
      ],
      truncated: false,
    });
    expect(snapshot.value.listFiles("docs")).toMatchObject({
      files: [{ path: "docs/brief.md" }],
    });
    await expect(
      snapshot.value.readFile("docs/brief.md", 2, 3),
    ).resolves.toEqual({
      ok: true,
      path: "docs/brief.md",
      startLine: 2,
      endLine: 3,
      totalLines: 3,
      text: "2| Участник создаёт заявку.\n3| Чужой участник не видит заявку.",
      truncated: false,
    });
    await expect(snapshot.value.readFile("logo.png", 1, 5)).resolves.toEqual({
      ok: false,
      reason: "binary",
    });
    await expect(
      snapshot.value.readFile("../outside.txt", 1, 1),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(snapshot.value.searchText("ЧУЖОЙ", "")).resolves.toEqual({
      matches: [
        {
          path: "docs/brief.md",
          line: 3,
          text: "Чужой участник не видит заявку.",
        },
      ],
      truncated: false,
    });
  });

  test("keeps only regular files and removes everything on dispose", async () => {
    const archive = await repositoryArchive(
      { "README.md": "readme\n" },
      { symlinks: { "escape.md": "/etc/passwd" } },
    );
    const directory = await root();
    const snapshot = await openRepositorySnapshot(archive, directory);
    if (!snapshot.ok) throw new Error(snapshot.reason);
    expect(snapshot.value.listFiles("").files.map(({ path }) => path)).toEqual([
      "README.md",
    ]);
    await snapshot.value.dispose();
    expect(await readdir(directory)).toEqual([]);
  });

  test("refuses an archive over the unpacked size limit", async () => {
    const archive = await repositoryArchive({
      "big.txt": "x".repeat(2048),
    });
    const directory = await root();
    await expect(
      openRepositorySnapshot(archive, directory, { unpackedByteLimit: 1024 }),
    ).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(await readdir(directory)).toEqual([]);
  });

  test("a starting worker removes snapshots left by a stopped process", async () => {
    const parent = await root();
    const snapshotDirectory = join(parent, "inside-course-assistant");
    await mkdir(join(snapshotDirectory, "review-left"), { recursive: true });
    await writeFile(join(snapshotDirectory, "review-left", "app.mjs"), "code");
    await removeLeftoverSnapshots({ snapshotDirectory });
    expect(await readdir(parent)).toEqual([]);
  });
});
