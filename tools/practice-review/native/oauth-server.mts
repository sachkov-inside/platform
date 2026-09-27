import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { z } from "zod";

/** A disposable authorization server. It knows only one invented participant. */
export async function startSyntheticAuthorizationServer() {
  const keys = await generateKeyPair("ES384");
  const publicJwk = {
    ...(await exportJWK(keys.publicKey)),
    alg: "ES384",
    kid: "practice-native",
  };
  const clients = new Map<string, string[]>();
  const codes = new Map<
    string,
    {
      clientId: string;
      redirectUri: string;
      challenge: string;
      resource: string;
    }
  >();
  const events: {
    kind: string;
    clientId?: string;
    pkce?: boolean;
    method?: string;
    tool?: string;
    part?: number;
    status?: number;
    tools?: string[];
    error?: string;
  }[] = [];
  let issuer = "";
  let resource = "";
  let upstream = "";
  const registration = z
    .object({ redirect_uris: z.array(z.url()).min(1) })
    .loose();
  const server = createServer((request, response) => {
    void handle().catch((error: unknown) => {
      if (response.destroyed) return;
      events.push({
        kind: "harness_error",
        method: request.method ?? "unknown",
        error: String(error)
          .replace(/https?:\/\/[^ ]+/g, "[url]")
          .slice(0, 400),
      });
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_request" }));
    });
    async function handle() {
      const url = new URL(request.url ?? "/", issuer);
      const reply = (status: number, data: unknown) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(data));
      };
      if (
        url.pathname.startsWith("/mcp") ||
        url.pathname.startsWith("/.well-known/oauth-protected-resource")
      ) {
        if (upstream.length === 0) {
          reply(503, { error: "starting" });
          return;
        }
        const text =
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await body();
        const wire =
          text === undefined || text.length === 0
            ? undefined
            : z
                .object({
                  method: z.string().optional(),
                  params: z
                    .object({
                      name: z.string().optional(),
                      arguments: z
                        .object({ part: z.number().optional() })
                        .loose()
                        .optional(),
                    })
                    .loose()
                    .optional(),
                })
                .loose()
                .safeParse(JSON.parse(text));
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (
            key === "host" ||
            key === "connection" ||
            key === "content-length" ||
            value === undefined
          )
            continue;
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const abort = new AbortController();
        response.once("close", () => {
          abort.abort();
        });
        const forwarded = await fetch(
          new URL(url.pathname + url.search, upstream),
          {
            signal: abort.signal,
            method: request.method ?? "GET",
            headers,
            ...(text === undefined ? {} : { body: text }),
          },
        );
        const event: (typeof events)[number] = {
          kind: "mcp",
          status: forwarded.status,
        };
        if (wire?.success === true) {
          if (wire.data.method !== undefined) event.method = wire.data.method;
          if (wire.data.params?.name !== undefined)
            event.tool = wire.data.params.name;
          if (wire.data.params?.arguments?.part !== undefined)
            event.part = wire.data.params.arguments.part;
        }
        events.push(event);
        response.writeHead(
          forwarded.status,
          Object.fromEntries(
            [...forwarded.headers].filter(
              ([key]) =>
                key !== "content-encoding" &&
                key !== "content-length" &&
                key !== "transfer-encoding",
            ),
          ),
        );
        response.flushHeaders();
        let listResponse = "";
        if (forwarded.body !== null)
          for await (const chunk of forwarded.body) {
            if (event.method === "tools/list")
              listResponse += Buffer.from(chunk).toString("utf8");
            response.write(chunk);
          }
        response.end();
        if (event.method === "tools/list" && forwarded.ok) {
          const json = listResponse.startsWith("event:")
            ? listResponse
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("")
            : listResponse;
          try {
            const parsed = z
              .object({
                result: z.object({
                  tools: z.array(z.object({ name: z.string() })),
                }),
              })
              .safeParse(JSON.parse(json));
            if (parsed.success)
              event.tools = parsed.data.result.tools.map((tool) => tool.name);
          } catch {
            /* Wire observation must never change the production response. */
          }
        }
        return;
      }
      if (
        url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/openid-configuration"
      ) {
        events.push({ kind: "discovery" });
        reply(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["learning:read"],
        });
        return;
      }
      if (url.pathname === "/jwks") {
        reply(200, { keys: [publicJwk] });
        return;
      }
      if (url.pathname === "/register" && request.method === "POST") {
        const data = registration.parse(JSON.parse(await body()));
        for (const redirect of data.redirect_uris) {
          const target = new URL(redirect);
          if (
            !new Set(["localhost", "127.0.0.1", "[::1]"]).has(
              target.hostname,
            ) ||
            target.protocol !== "http:"
          )
            throw new Error("Non-loopback redirect refused");
        }
        const clientId = randomUUID();
        clients.set(clientId, data.redirect_uris);
        events.push({ kind: "registration", clientId });
        reply(201, {
          ...data,
          client_id: clientId,
          token_endpoint_auth_method: "none",
        });
        return;
      }
      if (url.pathname === "/authorize") {
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const challenge = url.searchParams.get("code_challenge") ?? "";
        if (
          clients.get(clientId)?.includes(redirectUri) !== true ||
          url.searchParams.get("code_challenge_method") !== "S256" ||
          challenge.length === 0 ||
          url.searchParams.get("response_type") !== "code"
        )
          throw new Error("Invalid authorization");
        const requestedResource = url.searchParams.get("resource") ?? resource;
        if (requestedResource !== resource) throw new Error("Wrong resource");
        const code = randomUUID();
        codes.set(code, { clientId, redirectUri, challenge, resource });
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", code);
        const state = url.searchParams.get("state");
        if (state !== null) callback.searchParams.set("state", state);
        events.push({ kind: "authorization", clientId, pkce: true });
        response.writeHead(302, {
          location: callback.href,
          "cache-control": "no-store",
        });
        response.end();
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const form = new URLSearchParams(await body());
        const code = form.get("code") ?? "";
        const grant = codes.get(code);
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          grant === undefined ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== grant.clientId ||
          form.get("redirect_uri") !== grant.redirectUri ||
          challenge !== grant.challenge ||
          (form.has("resource") && form.get("resource") !== grant.resource)
        ) {
          reply(400, { error: "invalid_grant" });
          return;
        }
        codes.delete(code);
        const now = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({ scope: "learning:read" })
          .setProtectedHeader({ alg: "ES384", kid: "practice-native" })
          .setIssuer(issuer)
          .setAudience(resource)
          .setSubject("synthetic-participant")
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(keys.privateKey);
        events.push({
          kind: "token_exchange",
          clientId: grant.clientId,
          pkce: true,
        });
        reply(200, {
          access_token: token,
          token_type: "Bearer",
          expires_in: 300,
          scope: "learning:read",
        });
        return;
      }
      reply(404, { error: "not_found" });
      async function body() {
        let text = "";
        for await (const chunk of request) {
          text += String(chunk);
          if (text.length > 65536) throw new Error("Request too large");
        }
        return text;
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No authorization address");
  issuer = `http://127.0.0.1:${String(address.port)}`;
  return {
    issuer,
    publicJwk,
    events,
    setResource(value: string) {
      resource = value;
    },
    setUpstream(value: string) {
      upstream = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
  };
}
