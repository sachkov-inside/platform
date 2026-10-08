// @ts-check
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
 *
 * `learningResource` is the learner MCP resource (#948). A refresh grant that names it receives a
 * token for that audience with the `learning:read` scope, as Logto issues it to a learner's agent.
 *
 * @param {{ apiBaseUrl: string; webBaseUrl: string; learningResource?: string; now?: () => number }} endpoints
 */
export async function startFullStackIdentity({
  apiBaseUrl,
  webBaseUrl,
  learningResource,
  now = Date.now,
}) {
  const fullStackAccessTokenTtlSeconds = 300;
  const issuer = "https://identity.fullstack.test/oidc";
  const subject = "fullstack-owner";
  const memberSubject = "fullstack-member";
  const audience = apiBaseUrl;
  const appId = "inside-web-fullstack";
  const learningScope = "learning:read";
  const cookieSecret = "inside-fullstack-cookie-secret-key";
  const keyPair = await generateKeyPair("ES384");
  const publicJwk = {
    ...(await exportJWK(keyPair.publicKey)),
    alg: "ES384",
    kid: "fullstack-key-1",
  };
  /** Выданные refresh-токены: каждый помнит, чью сессию он продлевает. */
  /** @type {Map<string, string>} */
  const refreshTokens = new Map();
  /**
   * @param {string} tokenSubject
   * @param {number} issuedAt
   * @param {{ audience: string; scope?: string }} [target]
   */
  const mintAccessToken = async (
    tokenSubject,
    issuedAt,
    target = { audience },
  ) => {
    const token = await new SignJWT({
      inside_verified_email: `${tokenSubject}@inside.test`,
      ...(target.scope === undefined ? {} : { scope: target.scope }),
    })
      .setProtectedHeader({ alg: "ES384", kid: "fullstack-key-1" })
      .setIssuer(issuer)
      .setAudience(target.audience)
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
    mintAccessToken(tokenSubject, Math.floor(now() / 1_000));
  /** @param {{ token: string; expiresAt: number; refreshToken: string }} session */
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
  /** @param {string} tokenSubject */
  const issueRefreshToken = (tokenSubject) => {
    const refreshToken = `fullstack-refresh-${randomUUID()}`;
    refreshTokens.set(refreshToken, tokenSubject);
    return refreshToken;
  };
  /**
   * Сессия, доступ которой уже истёк. Продление обязано случиться на первом же запросе, поэтому
   * проверять его можно за секунды, а не ожиданием пяти минут в каждом следующем прогоне.
   */
  /**
   * @param {string} tokenSubject
   * @param {string} refreshToken
   */
  const sessionCookiePastExpiry = async (tokenSubject, refreshToken) => {
    const issuedAt =
      Math.floor(now() / 1_000) - fullStackAccessTokenTtlSeconds * 2;
    const stale = await mintAccessToken(tokenSubject, issuedAt);
    return sessionCookie({
      token: stale.token,
      expiresAt: stale.expiresAt,
      refreshToken,
    });
  };
  const server = createServer((request, response) => {
    void route(request, response);
  });
  /** @type {Promise<void>} */
  const listening = new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  await listening;
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Full-stack identity server has no TCP port");
  }
  const origin = `http://127.0.0.1:${String(address.port)}`;

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  async function route(request, response) {
    if (request.url === "/jwks") {
      sendJson(response, 200, { keys: [publicJwk] });
      return;
    }
    if (request.url === "/oidc/.well-known/openid-configuration") {
      // Объявляется только то, что здесь действительно есть. Вход и выход в наборе идут через
      // готовые cookie, а не через браузерный поток, поэтому обещать несуществующие адреса нельзя:
      // это увело бы разбор очередного падения к «эндпоинту», которого никто не реализовывал.
      sendJson(response, 200, {
        issuer,
        token_endpoint: `${origin}/oidc/token`,
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
   *
   * Отказ отдаётся в том же виде, в каком его отдаёт Logto: `code` и `message` рядом с `error`.
   * Клиент Logto разбирает ошибку только по этой паре, иначе отказ станет для приложения
   * «неожиданным ответом», и непродлеваемая сессия покажется недоступностью сервиса.
   *
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  async function issueRenewedToken(request, response) {
    const parameters = new URLSearchParams(await readBody(request));
    if (parameters.get("grant_type") !== "refresh_token") {
      sendJson(
        response,
        400,
        grantFailure(
          "unsupported_grant_type",
          "Only the refresh_token grant is served here",
        ),
      );
      return;
    }
    const presented = parameters.get("refresh_token") ?? "";
    const tokenSubject = refreshTokens.get(presented);
    if (tokenSubject === undefined) {
      sendJson(
        response,
        400,
        grantFailure("invalid_grant", "Unknown refresh token"),
      );
      return;
    }
    // Токен выпускается ровно на свою аудиторию. Без этой проверки чужой resource молча получил
    // бы рабочий токен, и ошибка в настройке аудитории проходила бы в наборе, но не в продакшене.
    const resource = parameters.get("resource");
    const learning =
      learningResource !== undefined && resource === learningResource;
    if (resource !== null && resource !== audience && !learning) {
      sendJson(
        response,
        400,
        grantFailure(
          "invalid_target",
          "Requested resource is not this audience",
        ),
      );
      return;
    }
    const renewed = learning
      ? await mintAccessToken(tokenSubject, Math.floor(now() / 1_000), {
          audience: learningResource,
          scope: learningScope,
        })
      : await createAccessToken(tokenSubject);
    sendJson(response, 200, {
      access_token: renewed.token,
      refresh_token: presented,
      expires_in: fullStackAccessTokenTtlSeconds,
      scope: learning ? learningScope : "",
      token_type: "Bearer",
    });
  }

  return {
    cookieName: `logto_${appId}`,
    memberSubject,
    /** Срок доступа: он остаётся коротким, и это значение — его единственный владелец. */
    accessTokenTtlSeconds: fullStackAccessTokenTtlSeconds,
    createAccessToken,
    /**
     * Cookie сессии. Вместе с первым токеном в неё кладётся refresh-токен, поэтому истёкший
     * доступ приложение продлевает само и сессия живёт весь прогон, а не первые пять минут.
     *
     * @param {{ token: string; expiresAt: number; subject?: string }} session
     */
    createSession: ({ token, expiresAt, subject: tokenSubject = subject }) =>
      sessionCookie({
        token,
        expiresAt,
        refreshToken: issueRefreshToken(tokenSubject),
      }),
    /**
     * Refresh-токен без cookie: им агент ученика получает доступ к учебному MCP на время сценария,
     * а не на пять минут от старта набора.
     */
    createRefreshToken: issueRefreshToken,
    /** Истёкшая сессия, которую есть чем продлить. */
    createSessionPastExpiry: (tokenSubject = subject) =>
      sessionCookiePastExpiry(tokenSubject, issueRefreshToken(tokenSubject)),
    /**
     * Та же истёкшая сессия, но продлить её нечем: refresh-токен неизвестен этому серверу.
     * Ею проверяется, что истечение видно как истечение, а не как пустая или сломанная страница.
     */
    createSessionWithoutRenewal: (tokenSubject = subject) =>
      sessionCookiePastExpiry(
        tokenSubject,
        `fullstack-refresh-unknown-${randomUUID()}`,
      ),
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
    close: () => {
      /** @type {Promise<void>} */
      const closed = new Promise((resolveClose, rejectClose) => {
        server.close((error) =>
          error === undefined ? resolveClose() : rejectClose(error),
        );
      });
      return closed;
    },
  };
}

/**
 * Отказ в выдаче токена в форме fork Logto (#1005): `error` — код OAuth, `code` — он же с
 * префиксом `oidc.`, `message` — текст. Клиент Logto бросает по `code` и `message`
 * `LogtoRequestError`, и web узнаёт отвергнутый grant по коду `oidc.invalid_grant`.
 *
 * @param {string} error
 * @param {string} message
 */
function grantFailure(error, message) {
  return { error, code: `oidc.${error}`, message };
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** @param {import("node:http").IncomingMessage} request */
async function readBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of request) {
    // Without an encoding a request stream yields bytes.
    if (!Buffer.isBuffer(chunk)) throw new Error("Request stream yielded text");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
