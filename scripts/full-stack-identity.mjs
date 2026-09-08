import { createServer } from "node:http";
import { wrapSession } from "@logto/node";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

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
  const server = createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Full-stack JWKS server has no TCP port");
  }
  return {
    cookieName: `logto_${appId}`,
    memberSubject,
    createAccessToken: async (tokenSubject = subject) => {
      const now = Math.floor(Date.now() / 1_000);
      const token = await new SignJWT({
        inside_verified_email: `${tokenSubject}@inside.test`,
      })
        .setProtectedHeader({ alg: "ES384", kid: "fullstack-key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(tokenSubject)
        .setIssuedAt(now)
        .setExpirationTime(now + fullStackAccessTokenTtlSeconds)
        .sign(keyPair.privateKey);
      return { token, expiresAt: now + fullStackAccessTokenTtlSeconds };
    },
    createSession: async ({ token, expiresAt }) => {
      return wrapSession(
        {
          idToken: "fullstack.id.token",
          accessToken: JSON.stringify({
            [`@${audience}`]: {
              token,
              scope: "",
              expiresAt,
            },
          }),
        },
        cookieSecret,
      );
    },
    environment: {
      LOGTO_APP_ID: appId,
      LOGTO_APP_SECRET: "inside-fullstack-app-secret",
      LOGTO_AUDIENCE: audience,
      LOGTO_COOKIE_SECRET: cookieSecret,
      LOGTO_ENDPOINT: "https://identity.fullstack.test",
      LOGTO_ISSUER: issuer,
      LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
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
