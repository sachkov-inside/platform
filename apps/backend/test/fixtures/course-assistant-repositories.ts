import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create } from "tar";
import type { RepositoryReader } from "../../src/modules/course-assistant/ports/repository-reader.js";

export type RepositoryFiles = Readonly<Record<string, string | Uint8Array>>;

/**
 * tar.gz в раскладке архива GitHub: всё содержимое лежит в одном каталоге верхнего уровня,
 * который снимок срезает.
 */
export async function repositoryArchive(
  files: RepositoryFiles,
  options: { readonly symlinks?: Readonly<Record<string, string>> } = {},
): Promise<Uint8Array> {
  const workspace = await mkdtemp(join(tmpdir(), "synthetic-repository-"));
  const top = "learner-agent-course-0123456";
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(workspace, top, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    for (const [path, destination] of Object.entries(options.symlinks ?? {})) {
      const target = join(workspace, top, path);
      await mkdir(dirname(target), { recursive: true });
      await symlink(destination, target);
    }
    const chunks: Buffer[] = [];
    const stream = create({ gzip: true, cwd: workspace, portable: true }, [
      top,
    ]);
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

interface FakeRepositoryState {
  readonly defaultBranch: string;
  readonly head: string;
  readonly commits: Map<string, RepositoryFiles>;
  readonly pullRequests: {
    readonly number: number;
    readonly title: string;
    readonly headRef: string;
    readonly headSha: string;
  }[];
}

export interface FakeRepositoryReader extends RepositoryReader {
  /** Основная ветка указывает на новый коммит с этими файлами. */
  push(fullName: string, sha: string, files: RepositoryFiles): void;
  openPullRequest(
    fullName: string,
    pull: {
      readonly number: number;
      readonly title: string;
      readonly sha: string;
      readonly files: RepositoryFiles;
    },
  ): void;
  closePullRequest(fullName: string, number: number): void;
  revoke(fullName: string): void;
  failNextCalls(): void;
  readonly downloads: string[];
}

/** Двойник чтения репозиториев: коммиты, открытые PR, отзыв доступа и сбой GitHub. */
export function fakeRepositoryReader(): FakeRepositoryReader {
  const repositories = new Map<string, FakeRepositoryState>();
  let failing = false;
  const downloads: string[] = [];
  const read = (fullName: string) => {
    if (failing)
      return { ok: false as const, reason: "dependency_unavailable" as const };
    const repository = repositories.get(fullName);
    return repository === undefined
      ? { ok: false as const, reason: "revoked" as const }
      : { ok: true as const, repository };
  };
  return {
    downloads,
    readOverview(linked) {
      const found = read(linked.fullName);
      if (!found.ok) return Promise.resolve(found);
      const { repository } = found;
      return Promise.resolve({
        ok: true,
        overview: {
          defaultBranch: {
            name: repository.defaultBranch,
            sha: repository.head,
          },
          pullRequests: repository.pullRequests.map((pull) => ({
            ...pull,
            baseRef: repository.defaultBranch,
            baseSha: repository.head,
          })),
          recentCommits: [
            {
              sha: repository.head,
              message: "Последний коммит",
              committedAt: "2026-09-28T10:00:00Z",
            },
          ],
        },
      });
    },
    async downloadArchive(linked, sha) {
      const found = read(linked.fullName);
      if (!found.ok) return found;
      const files = found.repository.commits.get(sha);
      if (files === undefined)
        return { ok: false, reason: "dependency_unavailable" };
      downloads.push(sha);
      return { ok: true, archive: await repositoryArchive(files) };
    },
    compareCommits(linked, base, head) {
      const found = read(linked.fullName);
      if (!found.ok) return Promise.resolve(found);
      const before = found.repository.commits.get(base) ?? {};
      const after = found.repository.commits.get(head) ?? {};
      return Promise.resolve({
        ok: true,
        files: Object.keys(after)
          .filter((path) => before[path] !== after[path])
          .map((path) => ({
            path,
            status: path in before ? "modified" : "added",
            additions: 1,
            deletions: 0,
            patch: `@@ ${path} @@`,
          })),
      });
    },
    push(fullName, sha, files) {
      const existing = repositories.get(fullName);
      const commits = existing?.commits ?? new Map<string, RepositoryFiles>();
      commits.set(sha, files);
      repositories.set(fullName, {
        defaultBranch: "main",
        head: sha,
        commits,
        pullRequests: existing?.pullRequests ?? [],
      });
    },
    openPullRequest(fullName, pull) {
      const repository = repositories.get(fullName);
      if (repository === undefined)
        throw new Error("Push the repository first");
      repository.commits.set(pull.sha, pull.files);
      repository.pullRequests.push({
        number: pull.number,
        title: pull.title,
        headRef: `feature-${String(pull.number)}`,
        headSha: pull.sha,
      });
    },
    closePullRequest(fullName, number) {
      const repository = repositories.get(fullName);
      if (repository === undefined) return;
      const index = repository.pullRequests.findIndex(
        (pull) => pull.number === number,
      );
      if (index >= 0) repository.pullRequests.splice(index, 1);
    },
    revoke(fullName) {
      repositories.delete(fullName);
    },
    failNextCalls() {
      failing = true;
    },
  };
}
