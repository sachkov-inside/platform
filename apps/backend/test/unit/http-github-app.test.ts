import { generateKeyPairSync } from "node:crypto";
import { decodeJwt } from "jose";
import { describe, expect, test, vi } from "vitest";
import { HttpGitHubApp } from "../../src/modules/course-assistant/infrastructure/github/http-github-app.js";

const origins = {
  web: "https://github.example.test",
  api: "https://api.github.example.test",
};
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = {
  slug: "inside-course",
  clientId: "Iv23synthetic",
  clientSecret: "synthetic-client-secret",
  privateKey,
};

function github(routes: Record<string, () => Response>) {
  const fetcher = vi.fn<typeof fetch>((input) => {
    const url = new URL(requestUrl(input));
    const route = routes[url.pathname];
    return Promise.resolve(
      route === undefined ? new Response("{}", { status: 500 }) : route(),
    );
  });
  return { app: new HttpGitHubApp(credentials, fetcher, origins), fetcher };
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpGitHubApp", () => {
  test("install URL carries the connection state unchanged", () => {
    const { app } = github({});
    expect(app.installationUrl("state_value-1")).toBe(
      "https://github.example.test/apps/inside-course/installations/new?state=state_value-1",
    );
  });

  test("a read-only installation of the authorizing user is verified", async () => {
    const { app, fetcher } = github({
      "/login/oauth/access_token": () => json({ access_token: "ghu_user" }),
      "/user": () => json({ login: "learner" }),
      "/user/installations": () =>
        json({
          total_count: 2,
          installations: [
            { id: 1, permissions: { metadata: "read" } },
            {
              id: 42,
              permissions: {
                metadata: "read",
                contents: "read",
                pull_requests: "read",
              },
            },
          ],
        }),
    });

    await expect(
      app.verifyInstallationOwner({ code: "code", installationId: 42 }),
    ).resolves.toEqual({ ok: true, login: "learner" });
    const exchange = fetcher.mock.calls[0];
    expect(exchange === undefined ? "" : requestUrl(exchange[0])).toBe(
      "https://github.example.test/login/oauth/access_token",
    );
    // Этот адрес отвечает JSON только на `Accept: application/json`, иначе — формой.
    expect(new Headers(exchange?.[1]?.headers).get("accept")).toBe(
      "application/json",
    );
    const body = exchange?.[1]?.body;
    if (typeof body !== "string") throw new TypeError("Expected a JSON body");
    expect(JSON.parse(body)).toEqual({
      client_id: "Iv23synthetic",
      client_secret: "synthetic-client-secret",
      code: "code",
    });
  });

  test("an installation the user cannot see, a write permission and a spent code are refused", async () => {
    const installations = (permissions: Record<string, string>) =>
      github({
        "/login/oauth/access_token": () => json({ access_token: "ghu_user" }),
        "/user": () => json({ login: "learner" }),
        "/user/installations": () =>
          json({ total_count: 1, installations: [{ id: 42, permissions }] }),
      }).app;

    await expect(
      installations({ metadata: "read" }).verifyInstallationOwner({
        code: "code",
        installationId: 7,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_owner" });
    await expect(
      installations({
        metadata: "read",
        contents: "write",
      }).verifyInstallationOwner({ code: "code", installationId: 42 }),
    ).resolves.toEqual({ ok: false, reason: "write_access_requested" });
    await expect(
      installations({
        metadata: "read",
        issues: "read",
      }).verifyInstallationOwner({ code: "code", installationId: 42 }),
    ).resolves.toEqual({ ok: false, reason: "write_access_requested" });

    const spent = github({
      "/login/oauth/access_token": () =>
        json({ error: "bad_verification_code" }),
    }).app;
    await expect(
      spent.verifyInstallationOwner({ code: "old", installationId: 42 }),
    ).resolves.toEqual({ ok: false, reason: "invalid_code" });
  });

  test("repositories are read with an installation token signed by the app key", async () => {
    const { app, fetcher } = github({
      "/app/installations/42/access_tokens": () =>
        json(
          {
            token: "ghs_installation",
            permissions: {
              metadata: "read",
              contents: "read",
              pull_requests: "read",
            },
          },
          201,
        ),
      "/installation/repositories": () =>
        json({
          total_count: 1,
          repositories: [
            {
              id: 101,
              full_name: "learner/agent-course",
              html_url: "https://github.com/learner/agent-course",
            },
          ],
        }),
    });

    await expect(app.listInstallationRepositories(42)).resolves.toEqual({
      ok: true,
      repositories: [
        {
          id: 101,
          fullName: "learner/agent-course",
          htmlUrl: "https://github.com/learner/agent-course",
        },
      ],
    });
    const tokenRequest = fetcher.mock.calls[0]?.[1];
    const authorization = new Headers(tokenRequest?.headers).get(
      "authorization",
    );
    const claims = decodeJwt(authorization?.replace("Bearer ", "") ?? "");
    expect(claims.iss).toBe("Iv23synthetic");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBeLessThanOrEqual(600);
    expect(
      new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer ghs_installation");
  });

  test("an installation whose permissions grew beyond reading is no longer available", async () => {
    const { app } = github({
      "/app/installations/42/access_tokens": () =>
        json(
          {
            token: "ghs_installation",
            permissions: { metadata: "read", contents: "write" },
          },
          201,
        ),
    });
    await expect(app.listInstallationRepositories(42)).resolves.toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  test("a removed or suspended installation is revoked; a GitHub outage is not", async () => {
    for (const status of [404, 403]) {
      const { app } = github({
        "/app/installations/42/access_tokens": () =>
          json({ message: "gone" }, status),
      });
      await expect(app.listInstallationRepositories(42)).resolves.toEqual({
        ok: false,
        reason: "revoked",
      });
    }
    const { app } = github({
      "/app/installations/42/access_tokens": () =>
        json({ message: "unavailable" }, 502),
    });
    await expect(app.listInstallationRepositories(42)).resolves.toEqual({
      ok: false,
      reason: "dependency_unavailable",
    });
  });
});

describe("HttpGitHubApp as the repository reader", () => {
  const repository = {
    installationId: 42,
    repositoryId: 101,
    fullName: "learner/agent-course",
  };
  const readToken = () =>
    json(
      {
        token: "ghs_repository",
        permissions: {
          metadata: "read",
          contents: "read",
          pull_requests: "read",
        },
      },
      201,
    );

  test("the token is scoped to the linked repository and to reading", async () => {
    const { app, fetcher } = github({
      "/app/installations/42/access_tokens": readToken,
      "/repos/learner/agent-course": () => json({ default_branch: "main" }),
      "/repos/learner/agent-course/branches/main": () =>
        json({ commit: { sha: "a".repeat(40) } }),
      "/repos/learner/agent-course/pulls": () =>
        json([
          {
            number: 3,
            title: "Реализация консультаций",
            draft: false,
            user: { type: "User" },
            head: {
              ref: "feature",
              sha: "b".repeat(40),
              repo: { id: 101 },
            },
            base: { ref: "main", sha: "a".repeat(40) },
          },
          {
            number: 4,
            title: "Из форка",
            draft: false,
            user: { type: "User" },
            head: { ref: "main", sha: "c".repeat(40), repo: { id: 999 } },
            base: { ref: "main", sha: "a".repeat(40) },
          },
          {
            number: 5,
            title: "Удалённый форк",
            draft: false,
            user: null,
            head: { ref: "gone", sha: "d".repeat(40), repo: null },
            base: { ref: "main", sha: "a".repeat(40) },
          },
          {
            number: 6,
            title: "Bump zod",
            draft: true,
            user: { type: "Bot" },
            head: { ref: "deps", sha: "e".repeat(40), repo: { id: 101 } },
            base: { ref: "main", sha: "a".repeat(40) },
          },
        ]),
      "/repos/learner/agent-course/commits": () =>
        json([
          {
            sha: "a".repeat(40),
            commit: {
              message: "Бриф консультаций\n\nПодробности",
              committer: { date: "2026-09-28T10:00:00Z" },
            },
          },
        ]),
    });

    await expect(app.readOverview(repository)).resolves.toEqual({
      ok: true,
      overview: {
        defaultBranch: { name: "main", sha: "a".repeat(40) },
        pullRequests: [
          {
            number: 3,
            title: "Реализация консультаций",
            headRef: "feature",
            headSha: "b".repeat(40),
            baseRef: "main",
            baseSha: "a".repeat(40),
            draft: false,
            authorIsBot: false,
          },
          {
            number: 6,
            title: "Bump zod",
            headRef: "deps",
            headSha: "e".repeat(40),
            baseRef: "main",
            baseSha: "a".repeat(40),
            draft: true,
            authorIsBot: true,
          },
        ],
        recentCommits: [
          {
            sha: "a".repeat(40),
            message: "Бриф консультаций",
            committedAt: "2026-09-28T10:00:00Z",
          },
        ],
      },
    });
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new TypeError("Expected a JSON body");
    expect(JSON.parse(body)).toEqual({
      repository_ids: [101],
      permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "read",
      },
    });
  });

  test("a repository removed from the installation is revoked", async () => {
    const { app } = github({
      "/app/installations/42/access_tokens": () =>
        json(
          { message: "There is at least one repository that does not exist" },
          422,
        ),
    });
    await expect(app.readOverview(repository)).resolves.toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  test("the archive of an exact commit is read within its size limit", async () => {
    const archive = new Uint8Array([31, 139, 8, 0]);
    const { app, fetcher } = github({
      "/app/installations/42/access_tokens": readToken,
      [`/repos/learner/agent-course/tarball/${"a".repeat(40)}`]: () =>
        new Response(archive, { status: 200 }),
    });
    await expect(
      app.downloadArchive(repository, "a".repeat(40)),
    ).resolves.toEqual({ ok: true, archive });
    expect(
      new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer ghs_repository");

    const huge = github({
      "/app/installations/42/access_tokens": readToken,
      [`/repos/learner/agent-course/tarball/${"a".repeat(40)}`]: () =>
        new Response(new Uint8Array(0), {
          status: 200,
          headers: { "content-length": String(200 * 1024 * 1024) },
        }),
    }).app;
    await expect(
      huge.downloadArchive(repository, "a".repeat(40)),
    ).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  test("a comparison lists changed files with their patches", async () => {
    const { app } = github({
      "/app/installations/42/access_tokens": readToken,
      [`/repos/learner/agent-course/compare/${"a".repeat(40)}...${"b".repeat(40)}`]:
        () =>
          json({
            files: [
              {
                filename: "app.mjs",
                status: "modified",
                additions: 2,
                deletions: 1,
                patch: "@@ -1 +1,2 @@",
              },
              {
                filename: "logo.png",
                status: "added",
                additions: 0,
                deletions: 0,
              },
            ],
          }),
    });
    await expect(
      app.compareCommits(repository, "a".repeat(40), "b".repeat(40)),
    ).resolves.toEqual({
      ok: true,
      files: [
        {
          path: "app.mjs",
          status: "modified",
          additions: 2,
          deletions: 1,
          patch: "@@ -1 +1,2 @@",
        },
        {
          path: "logo.png",
          status: "added",
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
    });
  });
});
