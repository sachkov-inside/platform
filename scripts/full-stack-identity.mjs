import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { wrapSession } from "@logto/node";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

/**
 * Identity for the full-stack run: a real JWKS, a real discovery document and a real
 * refresh-token grant, all on loopback. The access token keeps its five-minute life and the API
 * keeps verifying it; when it runs out, the web BFF renews it exactly as it does in production.
 * Without that grant a run longer than five minutes silently loses every signed-in session and
 * reports it as broken pages instead of an expired token.
 */
export async function startFullStackIdentity({ apiBaseUrl, webBaseUrl }) {
  const fullStackAccessTokenTtlSeconds = 300;
  const issuer = "https://identity.fullstack.test/oidc";
  const subject = "fullstack-owner";
  const memberSubject = "fullstack-member";
  const audience = apiBaseUrl;
  const appId = "inside-web-fullstack";
  const cookieSecret = "inside-fullstack-cookie-secret-key";
  const keyPair = await generateKeyPair("ES384");
  const publicJwk = {
    ...(await exportJWK(keyPair.publicKey)),
    alg: "ES384",
    kid: "fullstack-key-1",
  };
  /** Выданные refresh-токены: каждый помнит, чью сессию он продлевает. */
  const refreshTokens = new Map();
  const mintAccessToken = async (tokenSubject, issuedAt) => {
    const token = await new SignJWT({
      inside_verified_email: `${tokenSubject}@inside.test`,
    })
      .setProtectedHeader({ alg: "ES384", kid: "fullstack-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(tokenSubject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + fullStackAccessTokenTtlSeconds)
      .sign(keyPair.privateKey);
    return {
      token,
      expiresAt: issuedAt + fullStackAccessTokenTtlSeconds,
      subject: tokenSubject,
    };
  };
  const createAccessToken = (tokenSubject = subject) =>
    mintAccessToken(tokenSubject, Math.floor(Date.now() / 1_000));
  const sessionCookie = ({ token, expiresAt, refreshToken }) =>
    wrapSession(
      {
        idToken: "fullstack.id.token",
        refreshToken,
        accessToken: JSON.stringify({
          [`@${audience}`]: { token, scope: "", expiresAt },
        }),
      },
      cookieSecret,
    );
  const issueRefreshToken = (tokenSubject) => {
    const refreshToken = `fullstack-refresh-${randomUUID()}`;
    refreshTokens.set(refreshToken, tokenSubject);
    return refreshToken;
  };
  const server = createServer((request, response) => {
    void route(request, response);
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Full-stack identity server has no TCP port");
  }
  const origin = `http://127.0.0.1:${String(address.port)}`;

  async function route(request, response) {
    if (request.url === "/jwks") {
      sendJson(response, 200, { keys: [publicJwk] });
      return;
    }
    if (request.url === "/oidc/.well-known/openid-configuration") {
      sendJson(response, 200, {
        issuer,
        authorization_endpoint: `${origin}/oidc/auth`,
        token_endpoint: `${origin}/oidc/token`,
        userinfo_endpoint: `${origin}/oidc/me`,
        end_session_endpoint: `${origin}/oidc/session/end`,
        revocation_endpoint: `${origin}/oidc/token/revocation`,
        jwks_uri: `${origin}/jwks`,
      });
      return;
    }
    if (request.url === "/oidc/token" && request.method === "POST") {
      await issueRenewedToken(request, response);
      return;
    }
    response.writeHead(404).end();
  }

  /**
   * Продление сессии по refresh-токену. Выдаётся такой же пятиминутный токен, что и на старте:
   * прогон живёт дольше, но приложение и API продолжают работать с коротким сроком и проверять его.
   */
  async function issueRenewedToken(request, response) {
    const parameters = new URLSearchParams(await readBody(request));
    if (parameters.get("grant_type") !== "refresh_token") {
      sendJson(response, 400, { error: "unsupported_grant_type" });
      return;
    }
    const presented = parameters.get("refresh_token") ?? "";
    const tokenSubject = refreshTokens.get(presented);
    if (tokenSubject === undefined) {
      sendJson(response, 400, { error: "invalid_grant" });
      return;
    }
    const resource = parameters.get("resource");
    if (resource !== null && resource !== audience) {
      sendJson(response, 400, { error: "invalid_target" });
      return;
    }
    const renewed = await createAccessToken(tokenSubject);
    sendJson(response, 200, {
      access_token: renewed.token,
      refresh_token: presented,
      expires_in: fullStackAccessTokenTtlSeconds,
      scope: "",
      token_type: "Bearer",
    });
  }

  return {
    cookieName: `logto_${appId}`,
    memberSubject,
    createAccessToken,
    /**
     * Cookie сессии. Вместе с первым токеном в неё кладётся refresh-токен, поэтому истёкший
     * доступ приложение продлевает само и сессия живёт весь прогон, а не первые пять минут.
     */
    createSession: ({ token, expiresAt, subject: tokenSubject = subject }) =>
      sessionCookie({
        token,
        expiresAt,
        refreshToken: issueRefreshToken(tokenSubject),
      }),
    /**
     * Сессия, у которой доступ уже истёк. Так продление проверяется за секунды, а не ожиданием
     * пяти минут: первый же запрос обязан пройти через token endpoint.
     */
    createSessionPastExpiry: async (tokenSubject = subject) => {
      const stale = await mintAccessToken(
        tokenSubject,
        Math.floor(Date.now() / 1_000) - fullStackAccessTokenTtlSeconds * 2,
      );
      return sessionCookie({
        token: stale.token,
        expiresAt: stale.expiresAt,
        refreshToken: issueRefreshToken(tokenSubject),
      });
    },
    /**
     * Та же истёкшая сессия, но продлить её нечем: refresh-токен неизвестен этому серверу.
     * Ею проверяется, что истечение видно как истечение, а не как пустая или сломанная страница.
     */
    createSessionWithoutRenewal: async (tokenSubject = subject) => {
      const stale = await mintAccessToken(
        tokenSubject,
        Math.floor(Date.now() / 1_000) - fullStackAccessTokenTtlSeconds * 2,
      );
      return sessionCookie({
        token: stale.token,
        expiresAt: stale.expiresAt,
        refreshToken: `fullstack-refresh-unknown-${randomUUID()}`,
      });
    },
    environment: {
      LOGTO_APP_ID: appId,
      LOGTO_APP_SECRET: "inside-fullstack-app-secret",
      LOGTO_AUDIENCE: audience,
      LOGTO_COOKIE_SECRET: cookieSecret,
      LOGTO_ENDPOINT: origin,
      LOGTO_ISSUER: issuer,
      LOGTO_JWKS_URL: `${origin}/jwks`,
      OWNER_LOGTO_ISSUER: issuer,
      OWNER_LOGTO_SUBJECT: subject,
      WEB_BASE_URL: webBaseUrl,
    },
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) =>
          error === undefined ? resolveClose() : rejectClose(error),
        );
      }),
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
