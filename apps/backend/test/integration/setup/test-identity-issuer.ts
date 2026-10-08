import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

/** Издатель токенов Account для настоящего транспорта: JWKS на свободном порту и подпись ES384. */
export interface TestIdentityIssuer {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  /** `audience` replaces the API audience for a token of another resource. */
  sign(
    subject: string,
    claims?: Readonly<Record<string, unknown>>,
    audience?: string,
  ): Promise<string>;
  close(): Promise<void>;
}

export async function startTestIdentityIssuer(input: {
  readonly issuer: string;
  readonly audience: string;
}): Promise<TestIdentityIssuer> {
  const pair = await generateKeyPair("ES384");
  const privateKey: CryptoKey = pair.privateKey;
  const kid = "test-identity-issuer-key";
  const publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    alg: "ES384",
    kid,
  };
  const server: Server = createServer((request, response) => {
    if (request.url !== "/jwks") return void response.writeHead(404).end();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("JWKS server has no TCP port");
  return {
    ...input,
    jwksUrl: `http://127.0.0.1:${String(address.port)}/jwks`,
    sign(subject, claims = {}, audience = input.audience) {
      // deterministic-test-allow wall-clock: Callers registerFixedClock; fixture and in-process consumers share virtual Date.
      const now = Math.floor(Date.now() / 1_000);
      return new SignJWT({ ...claims })
        .setProtectedHeader({ alg: "ES384", kid })
        .setIssuer(input.issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ),
  };
}
