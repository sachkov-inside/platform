/** Репозиторий Repository Link, к которому курс обращается через установку GitHub App. */
export interface LinkedRepository {
  readonly installationId: number;
  readonly repositoryId: number;
  readonly fullName: string;
}

export interface PullRequestHead {
  readonly number: number;
  readonly title: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
}

/** Где может лежать работа участника: основная ветка, открытые PR и недавние коммиты. */
export interface RepositoryOverview {
  readonly defaultBranch: { readonly name: string; readonly sha: string };
  /** Открытые PR из веток этого же репозитория; PR из форков сюда не входят. */
  readonly pullRequests: readonly PullRequestHead[];
  readonly recentCommits: readonly {
    readonly sha: string;
    readonly message: string;
    readonly committedAt: string;
  }[];
}

export interface ChangedFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  /** Патч GitHub; для больших и двоичных файлов его нет. */
  readonly patch: string | null;
}

export type RepositoryReadFailure =
  "revoked" | "too_large" | "dependency_unavailable";

type Read<T> = Promise<
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: RepositoryReadFailure }
>;

/**
 * Чтение репозитория участника только на чтение (#788). Код читается по точному commit SHA и в
 * базе не хранится. `revoked` — установка удалена, приостановлена, её права выросли за пределы
 * чтения или репозиторий из неё убран.
 */
export interface RepositoryReader {
  readOverview(repository: LinkedRepository): Read<{
    readonly overview: RepositoryOverview;
  }>;
  /** tar.gz архив точного коммита; больший предела архив — `too_large`. */
  downloadArchive(
    repository: LinkedRepository,
    commitSha: string,
  ): Read<{ readonly archive: Uint8Array }>;
  compareCommits(
    repository: LinkedRepository,
    base: string,
    head: string,
  ): Read<{ readonly files: readonly ChangedFile[] }>;
}
