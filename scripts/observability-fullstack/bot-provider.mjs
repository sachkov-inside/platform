// @ts-check
/** Private deterministic Bot API peer. No provider egress or raw request logging. */
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/** @param {{key:Buffer,cert:Buffer}} tls */
export function botProvider(tls) {
  const server = createServer(
    {
      ...tls,
      minVersion: "TLSv1.2",
      handshakeTimeout: 1000,
      requestTimeout: 2000,
      headersTimeout: 1000,
      connectionsCheckingInterval: 250,
    },
    (request, response) => {
      const finish = (
        status = 200,
        result = /** @type {unknown} */ ({ ok: true }),
      ) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      };
      if (request.method === "GET" && request.url === "/health") {
        finish();
        return;
      }
      if (
        request.method !== "POST" ||
        !/^\/bot1566:synthetic\/(getMe|getChatMember|sendMessage|answerCallbackQuery|deleteMessage)$/u.test(
          request.url ?? "",
        )
      ) {
        finish(403, { ok: false, error_code: 403 });
        return;
      }
      let bytes = 0;
      /** @type {Buffer[]} */ const chunks = [];
      const timer = setTimeout(() => request.destroy(), 2000);
      request.once("close", () => clearTimeout(timer));
      request.on("data", (/** @type {unknown} */ part) => {
        if (!Buffer.isBuffer(part) || (bytes += part.length) > 16384) {
          request.destroy();
          return;
        }
        chunks.push(part);
      });
      request.on("end", () => {
        /** @type {unknown} */ let raw;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          finish(400, { ok: false, error_code: 400 });
          return;
        }
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          finish(400, { ok: false, error_code: 400 });
          return;
        }
        const method = request.url?.split("/").at(-1);
        if (method === "getMe") {
          finish(200, {
            ok: true,
            result: {
              id: 1566,
              is_bot: true,
              first_name: "synthetic",
              username: "inside_fixture_bot",
            },
          });
          return;
        }
        if (method === "getChatMember") {
          const user = "user_id" in raw ? raw.user_id : undefined;
          const id =
            typeof user === "number" || typeof user === "string"
              ? Number(user)
              : NaN;
          if (
            !("chat_id" in raw) ||
            (raw.chat_id !== -1000000000000 && raw.chat_id !== "-1000000000000")
          ) {
            finish(400, { ok: false, error_code: 400 });
            return;
          }
          if (id === 1566) {
            finish(200, {
              ok: true,
              result: {
                status: "administrator",
                user: { id, is_bot: true, first_name: "synthetic" },
              },
            });
            return;
          }
          if (!Number.isSafeInteger(id) || id < 1000001 || id > 1000256) {
            finish(400, { ok: false, error_code: 400 });
            return;
          }
          finish(200, {
            ok: true,
            result: {
              status: "left",
              user: { id, is_bot: false, first_name: "synthetic" },
            },
          });
          return;
        }
        if (method === "sendMessage") {
          const id = "chat_id" in raw ? Number(raw.chat_id) : NaN;
          if (!Number.isSafeInteger(id) || id < 1000001 || id > 1000256) {
            finish(400, { ok: false, error_code: 400 });
            return;
          }
          finish(200, {
            ok: true,
            result: {
              message_id: 1,
              date: 1,
              chat: { id, type: "private" },
              text: "synthetic",
            },
          });
          return;
        }
        finish(200, { ok: true, result: true });
      });
      request.on("error", () => response.destroy());
    },
  );
  server.maxConnections = 16;
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = botProvider({
    key: readFileSync("/provider-tls/server.key"),
    cert: readFileSync("/provider-tls/server.pem"),
  });
  server.listen(443, "0.0.0.0");
  const stop = () => {
    server.closeAllConnections();
    server.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
