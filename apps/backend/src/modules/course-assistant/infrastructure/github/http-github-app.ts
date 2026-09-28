import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { GitHubApp, GitHubRepository } from "../../ports/github-app.js";

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
const installationTokenSchema = z.object({ token: z.string().min(1) });
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

interface GitHubRequest {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
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

/** GitHub App через REST API GitHub. */
export class HttpGitHubApp implements GitHubApp {
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
            headers: { "content-type": "application/json" },
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
      const writes = Object.entries(installation.permissions).some(
        ([permission, level]) =>
          !readOnlyPermissions.has(permission) || level !== "read",
      );
      if (writes) return { ok: false, reason: "write_access_requested" };
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

  /** Токен установки; удалённая (404) или приостановленная (403) установка — `undefined`. */
  private async installationToken(
    installationId: number,
  ): Promise<string | undefined> {
    const response = await this.request(
      new URL(
        `/app/installations/${String(installationId)}/access_tokens`,
        this.origins.api,
      ),
      {
        method: "POST",
        headers: { authorization: `Bearer ${await this.appToken()}` },
      },
    );
    if (response.status === 404 || response.status === 403) return undefined;
    if (!response.ok) throw new GitHubUnavailable(response.status);
    return installationTokenSchema.parse(await response.json()).token;
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
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  }
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
