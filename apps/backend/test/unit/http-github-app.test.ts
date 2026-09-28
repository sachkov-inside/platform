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
