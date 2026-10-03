import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { GitHubApp, GitHubRepository } from "../../ports/github-app.js";
import type {
  LinkedRepository,
  RepositoryReader,
  RepositoryReadFailure,
} from "../../ports/repository-reader.js";

/** Настройки GitHub App курса; ключи создаёт владелец, в репозитории их нет. */
export interface GitHubAppCredentials {
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly privateKey: string;
}

const requestTimeoutMilliseconds = 10_000;
/** GitHub принимает JWT приложения не дольше 10 минут; часы сервера могут спешить на минуту. */
const appTokenLifetimeSeconds = 9 * 60;
const appTokenClockSkewSeconds = 60;
const pageSize = 100;
/** Больше страниц — это уже не учебный проект одного участника. */
const pageLimit = 10;
/** Всё, что приложение вправе просить: только чтение. */
const readOnlyPermissions = new Set(["metadata", "contents", "pull_requests"]);
/** Токен для чтения репозитория сужается до одного репозитория и этих прав. */
const repositoryReadPermissions = {
  metadata: "read",
  contents: "read",
  pull_requests: "read",
} as const;
/** Архив учебного проекта больше этого — не учебный проект; скачивание не продолжается. */
const archiveByteLimit = 50 * 1024 * 1024;
const archiveTimeoutMilliseconds = 60_000;
const pullRequestLimit = 20;
const recentCommitLimit = 10;

const userTokenSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
]);
const userSchema = z.object({ login: z.string().min(1) });
const userInstallationsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      permissions: z.record(z.string(), z.string()),
    }),
  ),
});
const installationTokenSchema = z.object({
  token: z.string().min(1),
  permissions: z.record(z.string(), z.string()),
});
const installationRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      full_name: z.string().min(3),
      html_url: z.url(),
    }),
  ),
});

const repositorySchema = z.object({ default_branch: z.string().min(1) });
const branchSchema = z.object({ commit: z.object({ sha: z.hash("sha1") }) });
const pullRequestsSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    head: z.object({
      ref: z.string().min(1),
      sha: z.hash("sha1"),
      repo: z.object({ id: z.number().int().positive() }).nullable(),
    }),
    base: z.object({ ref: z.string().min(1), sha: z.hash("sha1") }),
  }),
);
const commitsSchema = z.array(
  z.object({
    sha: z.hash("sha1"),
    commit: z.object({
      message: z.string(),
      committer: z.object({ date: z.string() }).nullable(),
    }),
  }),
);
const comparisonSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        status: z.string(),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        patch: z.string().optional(),
      }),
    )
    .default([]),
});

interface GitHubRequest {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMilliseconds?: number;
}

class GitHubUnavailable extends Error {
  constructor(
    readonly status: number | undefined,
    options?: { readonly cause: unknown },
  ) {
    super(
      `GitHub request failed${status === undefined ? "" : `: ${status}`}`,
      options,
    );
  }
}

class ArchiveTooLarge extends Error {}

/** GitHub App через REST API GitHub. */
export class HttpGitHubApp implements GitHubApp, RepositoryReader {
  private readonly privateKey: KeyObject;

  constructor(
    private readonly credentials: GitHubAppCredentials,
    private readonly fetcher: typeof fetch = fetch,
    private readonly origins = {
      web: "https://github.com",
      api: "https://api.github.com",
    },
  ) {
    this.privateKey = createPrivateKey(credentials.privateKey);
  }

  installationUrl(state: string): string {
    const url = new URL(
      `/apps/${encodeURIComponent(this.credentials.slug)}/installations/new`,
      this.origins.web,
    );
    url.searchParams.set("state", state);
    return url.toString();
  }

  async verifyInstallationOwner(input: {
    readonly code: string;
    readonly installationId: number;
  }): ReturnType<GitHubApp["verifyInstallationOwner"]> {
    try {
      const exchanged = userTokenSchema.parse(
        await this.json(
          new URL("/login/oauth/access_token", this.origins.web),
          {
            method: "POST",
            // Этот адрес отвечает JSON только на `Accept: application/json`, иначе — формой.
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              client_id: this.credentials.clientId,
              client_secret: this.credentials.clientSecret,
              code: input.code,
            }),
          },
        ),
      );
      // GitHub отвечает на просроченный или чужой код статусом 200 и полем error.
      if ("error" in exchanged) return { ok: false, reason: "invalid_code" };
      const userToken = exchanged.access_token;
      const user = userSchema.parse(
        await this.json(new URL("/user", this.origins.api), {
          headers: { authorization: `Bearer ${userToken}` },
        }),
      );
      const installation = await this.findUserInstallation(
        userToken,
        input.installationId,
      );
      if (installation === undefined) return { ok: false, reason: "not_owner" };
      if (!readsOnly(installation.permissions))
        return { ok: false, reason: "write_access_requested" };
      return { ok: true, login: user.login };
    } catch (error) {
      reportDependencyFailure(
        { module: "course-assistant", operation: "verifyInstallationOwner" },
        error,
      );
      return { ok: false, reason: "dependency_unavailable" };
    }
  }

  async listInstallationRepositories(
    installationId: number,
  ): ReturnType<GitHubApp["listInstallationRepositories"]> {
    try {
      const token = await this.installationToken(installationId);
      if (token === undefined) return { ok: false, reason: "revoked" };
      const repositories: GitHubRepository[] = [];
      for (let page = 1; page <= pageLimit; page += 1) {
        const url = new URL("/installation/repositories", this.origins.api);
        url.searchParams.set("per_page", String(pageSize));
        url.searchParams.set("page", String(page));
        const listed = installationRepositoriesSchema.parse(
          await this.json(url, {
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        repositories.push(
          ...listed.repositories.map((repository) => ({
            id: repository.id,
            fullName: repository.full_name,
            htmlUrl: repository.html_url,
          })),
        );
        if (
          listed.repositories.length < pageSize ||
          repositories.length >= listed.total_count
        )
          break;
      }
      return { ok: true, repositories };
    } catch (error) {
      reportDependencyFailure(
        {
          module: "course-assistant",
          operation: "listInstallationRepositories",
        },
        error,
      );
      return { ok: false, reason: "dependency_unavailable" };
    }
  }

  readOverview(
    repository: LinkedRepository,
  ): ReturnType<RepositoryReader["readOverview"]> {
    return this.readRepository(
      "readRepositoryOverview",
      repository,
      async (get) => {
        const base = `/repos/${repositoryPath(repository.fullName)}`;
        const { default_branch: defaultBranch } = repositorySchema.parse(
          await get(base),
        );
        const branch = branchSchema.parse(
          await get(`${base}/branches/${encodeURIComponent(defaultBranch)}`),
        );
        const pulls = pullRequestsSchema.parse(
          await get(`${base}/pulls`, {
            state: "open",
            sort: "updated",
            direction: "desc",
            per_page: String(pullRequestLimit),
          }),
        );
        const commits = commitsSchema.parse(
          await get(`${base}/commits`, {
            sha: branch.commit.sha,
            per_page: String(recentCommitLimit),
          }),
        );
        return {
          overview: {
            defaultBranch: { name: defaultBranch, sha: branch.commit.sha },
            // PR из форка несёт чужой код: его ветку курс не читает.
            pullRequests: pulls
              .filter(({ head }) => head.repo?.id === repository.repositoryId)
              .map((pull) => ({
                number: pull.number,
                title: pull.title,
                headRef: pull.head.ref,
                headSha: pull.head.sha,
                baseRef: pull.base.ref,
                baseSha: pull.base.sha,
              })),
            recentCommits: commits.map(({ sha, commit }) => ({
              sha,
              message: commit.message.split("\n", 1)[0] ?? "",
              committedAt: commit.committer?.date ?? "",
            })),
          },
        };
      },
    );
  }

  downloadArchive(
    repository: LinkedRepository,
    commitSha: string,
  ): ReturnType<RepositoryReader["downloadArchive"]> {
    return this.readRepository(
      "downloadRepositoryArchive",
      repository,
      async (_get, token) => {
        const response = await this.request(
          new URL(
            `/repos/${repositoryPath(repository.fullName)}/tarball/${encodeURIComponent(commitSha)}`,
            this.origins.api,
          ),
          {
            headers: { authorization: `Bearer ${token}` },
            timeoutMilliseconds: archiveTimeoutMilliseconds,
          },
        );
        if (!response.ok) throw new GitHubUnavailable(response.status);
        return { archive: await limitedBody(response, archiveByteLimit) };
      },
    );
  }

  compareCommits(
    repository: LinkedRepository,
    base: string,
    head: string,
  ): ReturnType<RepositoryReader["compareCommits"]> {
    return this.readRepository(
      "compareRepositoryCommits",
      repository,
      async (get) => {
        const comparison = comparisonSchema.parse(
          await get(
            `/repos/${repositoryPath(repository.fullName)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
          ),
        );
        return {
          files: comparison.files.map((file) => ({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch ?? null,
          })),
        };
      },
    );
  }

  /**
   * Чтение репозитория токеном, суженным до этого репозитория и прав чтения. Отказ в таком токене
   * значит, что установка удалена, приостановлена или больше не открывает репозиторий.
   */
  private async readRepository<T>(
    operation: string,
    repository: LinkedRepository,
    read: (
      get: (
        path: string,
        query?: Readonly<Record<string, string>>,
      ) => Promise<unknown>,
      token: string,
    ) => Promise<T>,
  ): Promise<
    | ({ readonly ok: true } & T)
    | { readonly ok: false; readonly reason: RepositoryReadFailure }
  > {
    try {
      const token = await this.installationToken(repository.installationId, {
        repository_ids: [repository.repositoryId],
        permissions: repositoryReadPermissions,
      });
      if (token === undefined) return { ok: false, reason: "revoked" };
      const value = await read(async (path, query = {}) => {
        const url = new URL(path, this.origins.api);
        for (const [name, value] of Object.entries(query))
          url.searchParams.set(name, value);
        return this.json(url, {
          headers: { authorization: `Bearer ${token}` },
        });
      }, token);
      return { ok: true, ...value };
    } catch (error) {
      // Not a dependency failure: слишком большой архив — ответ о репозитории, а не сбой GitHub.
      if (error instanceof ArchiveTooLarge)
        return { ok: false, reason: "too_large" };
      reportDependencyFailure({ module: "course-assistant", operation }, error);
      return { ok: false, reason: "dependency_unavailable" };
    }
  }

  private async findUserInstallation(
    userToken: string,
    installationId: number,
  ) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const url = new URL("/user/installations", this.origins.api);
      url.searchParams.set("per_page", String(pageSize));
      url.searchParams.set("page", String(page));
      const listed = userInstallationsSchema.parse(
        await this.json(url, {
          headers: { authorization: `Bearer ${userToken}` },
        }),
      );
      const found = listed.installations.find(
        ({ id }) => id === installationId,
      );
      if (found !== undefined) return found;
      if (listed.installations.length < pageSize) return undefined;
    }
    return undefined;
  }

  /**
   * Токен установки. Удалённая (404) или приостановленная (403) установка, как и установка, чьи
   * права выросли за пределы чтения, — `undefined`: читать через неё курс больше не вправе.
   */
  private async installationToken(
    installationId: number,
    scope?: {
      readonly repository_ids: readonly number[];
      readonly permissions: Readonly<Record<string, string>>;
    },
  ): Promise<string | undefined> {
    const response = await this.request(
      new URL(
        `/app/installations/${String(installationId)}/access_tokens`,
        this.origins.api,
      ),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.appToken()}`,
          ...(scope === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(scope === undefined ? {} : { body: JSON.stringify(scope) }),
      },
    );
    // 422 на суженный токен: репозитория больше нет в установке.
    if (
      response.status === 404 ||
      response.status === 403 ||
      (scope !== undefined && response.status === 422)
    )
      return undefined;
    if (!response.ok) throw new GitHubUnavailable(response.status);
    const issued = installationTokenSchema.parse(await response.json());
    return readsOnly(issued.permissions) ? issued.token : undefined;
  }

  private appToken(): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000) - appTokenClockSkewSeconds;
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.credentials.clientId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + appTokenLifetimeSeconds)
      .sign(this.privateKey);
  }

  private async json(url: URL, init: GitHubRequest): Promise<unknown> {
    const response = await this.request(url, init);
    if (!response.ok) throw new GitHubUnavailable(response.status);
    return response.json();
  }

  private request(url: URL, init: GitHubRequest): Promise<Response> {
    return this.fetcher(url, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "sachkov-inside-platform",
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(
        init.timeoutMilliseconds ?? requestTimeoutMilliseconds,
      ),
    });
  }
}

function repositoryPath(fullName: string): string {
  return fullName.split("/").map(encodeURIComponent).join("/");
}

/** Тело ответа не больше предела; предел проверяется и по заголовку, и по прочитанным байтам. */
async function limitedBody(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) {
    await response.body?.cancel();
    throw new ArchiveTooLarge();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader !== undefined)
    for (;;) {
      const read: { readonly done: boolean; readonly value?: unknown } =
        await reader.read();
      if (read.done) break;
      const value = read.value;
      if (!(value instanceof Uint8Array))
        throw new TypeError("GitHub archive body is not binary");
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ArchiveTooLarge();
      }
      chunks.push(value);
    }
  return new Uint8Array(Buffer.concat(chunks));
}

function readsOnly(permissions: Readonly<Record<string, string>>): boolean {
  return Object.entries(permissions).every(
    ([permission, level]) =>
      readOnlyPermissions.has(permission) && level === "read",
  );
}

/** Помощник выключен и GitHub App не настроена: ни одна операция до GitHub не доходит. */
export const unconfiguredGitHubApp: GitHubApp = {
  installationUrl() {
    throw new Error("Course assistant GitHub App is not configured");
  },
  verifyInstallationOwner: () =>
    Promise.resolve({ ok: false, reason: "dependency_unavailable" }),
  listInstallationRepositories: () =>
    Promise.resolve({ ok: false, reason: "dependency_unavailable" }),
};

/** Без GitHub App репозиторий не читается: проверка отвечает сбоем поставщика. */
export const unconfiguredRepositoryReader: RepositoryReader = {
  readOverview: () =>
    Promise.resolve({ ok: false, reason: "dependency_unavailable" }),
  downloadArchive: () =>
    Promise.resolve({ ok: false, reason: "dependency_unavailable" }),
  compareCommits: () =>
    Promise.resolve({ ok: false, reason: "dependency_unavailable" }),
};
