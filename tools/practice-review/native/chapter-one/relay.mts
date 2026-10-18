import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { parseMcpResponse } from "./mcp.mjs";

const chatgptAuthSchema = z.object({
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().min(1),
  }),
});

/** Credentials remain on the host. The container gets only a short-lived lab capability. */
export async function startRelay(input: {
  capability: string;
  model: string;
  mcpUrl: string;
  learnerToken: () => Promise<string>;
  /** Tests supply a local upstream; the CLI always uses the fixed official endpoint. */
  provider?: { url: string; headers: () => Promise<Record<string, string>> };
}) {
  const provider = input.provider ?? {
    url: "https://chatgpt.com/backend-api/codex/responses",
    async headers() {
      const parsed = chatgptAuthSchema.parse(
        JSON.parse(await readFile(join(homedir(), ".codex/auth.json"), "utf8")),
      );
      return {
        authorization: `Bearer ${parsed.tokens.access_token}`,
        "chatgpt-account-id": parsed.tokens.account_id,
        originator: "codex_cli_rs",
      };
    },
  };
  const observations: {
    path: string;
    status: number;
    tool?: string;
    args?: unknown;
    result?: unknown;
  }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${input.capability}`);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        response.writeHead(401).end();
        return;
      }
      const path = request.url;
      if (
        request.method !== "POST" ||
        (path !== "/v1/responses" && path !== "/mcp/learning")
      ) {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw Error("Invalid request stream");
        const buffer = chunk;
        bytes += buffer.length;
        if (bytes > 2 * 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(buffer);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
      const mcp = path === "/mcp/learning";
      if (
        !mcp &&
        !z.object({ model: z.literal(input.model) }).safeParse(body).success
      ) {
        response.writeHead(400).end();
        return;
      }
      const abort = new AbortController();
      response.once("close", () => {
        abort.abort();
      });
      const upstream = await fetch(mcp ? input.mcpUrl : provider.url, {
        method: "POST",
        signal: abort.signal,
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(mcp
            ? {
                authorization: `Bearer ${await input.learnerToken()}`,
                ...(typeof request.headers["mcp-protocol-version"] === "string"
                  ? {
                      "mcp-protocol-version":
                        request.headers["mcp-protocol-version"],
                    }
                  : {}),
              }
            : await provider.headers()),
        },
        body: JSON.stringify(body),
      });
      const wire = z
        .object({
          params: z
            .object({ name: z.string(), arguments: z.unknown().optional() })
            .optional(),
        })
        .safeParse(body);
      const entry = {
        path,
        status: upstream.status,
        ...(wire.success && wire.data.params !== undefined
          ? { tool: wire.data.params.name, args: wire.data.params.arguments }
          : {}),
      };
      observations.push(entry);
      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      });
      response.flushHeaders();
      let result = "";
      if (upstream.body !== null)
        for await (const chunk of upstream.body) {
          if (mcp) result += Buffer.from(chunk).toString();
          response.write(chunk);
        }
      response.end();
      if (mcp) {
        try {
          Object.assign(entry, { result: parseMcpResponse(result) });
        } catch {
          Object.assign(entry, { result: "unparsed MCP response" });
        }
      }
    })().catch(() => {
      // Upstream failures must never expose provider headers, request bodies or credentials.
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      0,
      input.provider === undefined ? "0.0.0.0" : "127.0.0.1",
      resolve,
    );
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw Error("Relay has no TCP address");
  const port = address.port;
  return {
    port,
    observations,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
    },
  };
}
