// @ts-check
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, request as proxyRequest } from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import {
  localAccountsPage,
  localAccountsToolbarScript,
} from "./local-accounts-view.mjs";

const choices = ["owner", "learner-with-access", "learner", "guest"];
const choiceCookie = "inside.local-account";
const choiceCookieMaxAgeSeconds = 365 * 24 * 60 * 60;
const choiceFormBodyLimitBytes = 2048;
// Serve the foundation's exact token declarations, not a second local palette. Storybook
// already imports this same authority; the standalone gateway page loads these declarations.
const theme = readFileSync(
  new URL("../apps/web/app/globals.css", import.meta.url),
  "utf8",
).match(/:root\s*\{[^}]+\}/u)?.[0];
if (theme === undefined)
  throw new Error("Platform foundation tokens are missing");

/**
 * A loopback-only development adapter. Neither application imports this module.
 * @param {{ port: number; listenHost?: "127.0.0.1" | "0.0.0.0"; upstream: string; cookieName: string; secret: string; createSession: (choice: string) => Promise<string> }} options
 */
export async function startLocalAccountsGateway(options) {
  const upstreamUrl = new URL(options.upstream);
  if (
    !["127.0.0.1", "web"].includes(upstreamUrl.hostname) ||
    upstreamUrl.protocol !== "http:"
  )
    throw new Error("Expected local web upstream");
  if (options.secret.length < 32)
    throw new Error("Local account cookie secret is too short");
  let origin = "";
  /** @param {string} value */
  const sign = (value) =>
    createHmac("sha256", options.secret).update(value).digest("hex");
  /** @param {string} value */
  const encode = (value) => `${value}.${sign(value)}`;
  /** @param {string} choice */
  const selectionCookie = (choice) =>
    `${choiceCookie}=${encode(choice)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${choiceCookieMaxAgeSeconds}`;
  /** @param {string | undefined} header */
  function selection(header) {
    const values = (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${choiceCookie}=`));
    if (values.length === 0) return "owner";
    if (values.length !== 1) return "guest";
    const [value = "", signature = ""] = (values[0] ?? "")
      .slice(choiceCookie.length + 1)
      .split(".");
    const expected = sign(value);
    return choices.includes(value) &&
      /^[a-f0-9]{64}$/u.test(signature) &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      ? value
      : "guest";
  }
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  /** @param {import("node:http").IncomingMessage} request @param {import("node:http").ServerResponse} response */
  async function handle(request, response) {
    const publicUrl = new URL(origin);
    const host = request.headers.host;
    if (
      host === publicUrl.host.replace("127.0.0.1", "localhost") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      response
        .writeHead(307, {
          location: `${origin}${safeReturn(request.url)}`,
          "cache-control": "no-store",
        })
        .end();
      return;
    }
    if (
      !request.url?.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.includes("\\") ||
      [...request.url].some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      ) ||
      host !== publicUrl.host ||
      request.headers["sec-fetch-site"] === "cross-site" ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== origin)
    ) {
      response.writeHead(403).end("Local stand origin required");
      return;
    }
    response.setHeader("cache-control", "private, no-store");
    const choice = selection(request.headers.cookie);
    try {
      const path = new URL(request.url ?? "/", origin);
      if (path.pathname.startsWith("/__local/accounts")) {
        if (
          path.pathname === "/__local/accounts/theme.css" &&
          request.method === "GET"
        ) {
          response
            .writeHead(200, {
              "content-type": "text/css; charset=utf-8",
              "x-content-type-options": "nosniff",
            })
            .end(theme);
          return;
        }
        if (
          path.pathname === "/__local/accounts/toolbar.js" &&
          request.method === "GET"
        ) {
          response
            .writeHead(200, {
              "content-type": "text/javascript; charset=utf-8",
              "x-content-type-options": "nosniff",
            })
            .end(localAccountsToolbarScript());
          return;
        }
        if (path.pathname !== "/__local/accounts") {
          response.writeHead(404).end();
          return;
        }
        if (request.method === "POST") {
          if (
            request.headers.origin !== origin ||
            request.headers["content-type"] !==
              "application/x-www-form-urlencoded"
          ) {
            response.writeHead(403).end();
            return;
          }
          let body = "";
          for await (const chunk of request) {
            body += String(chunk);
            if (Buffer.byteLength(body) > choiceFormBodyLimitBytes) {
              response.writeHead(413).end();
              return;
            }
          }
          const form = new URLSearchParams(body);
          const next = form.get("choice") ?? "";
          if (!choices.includes(next) || form.getAll("choice").length !== 1) {
            response.writeHead(400).end();
            return;
          }
          response
            .writeHead(303, {
              location: safeReturn(form.get("returnTo")),
              "set-cookie": selectionCookie(next),
            })
            .end();
          return;
        }
        if (request.method !== "GET") {
          response.writeHead(405).end();
          return;
        }
        response
          .writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy":
              "default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          })
          .end(
            localAccountsPage({
              choice,
              returnTo: safeReturn(path.searchParams.get("returnTo")),
            }),
          );
        return;
      }
      // Logout is an explicit guest selection too. Ordinary Logto cookies never override it.
      if (
        path.pathname === "/auth/sign-out" &&
        request.method === "POST" &&
        request.headers.origin === origin
      ) {
        response
          .writeHead(303, {
            location: "/",
            "set-cookie": selectionCookie("guest"),
          })
          .end();
        return;
      }
      const retained = (request.headers.cookie ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter(
          (part) =>
            part !== "" &&
            !part.startsWith("logto_") &&
            !part.startsWith(`${choiceCookie}=`),
        );
      if (choice !== "guest")
        retained.push(
          `${options.cookieName}=${await options.createSession(choice)}`,
        );
      /** @type {import("node:http").OutgoingHttpHeaders} */
      const headers = {
        ...request.headers,
        host: upstreamUrl.host,
        cookie: retained.join("; "),
        "x-forwarded-host": publicUrl.host,
        "x-forwarded-proto": "http",
        "accept-encoding": "identity",
      };
      delete headers["forwarded"];
      delete headers["authorization"];
      delete headers["x-forwarded-for"];
      const target = new URL(request.url, upstreamUrl);
      if (target.origin !== upstreamUrl.origin) {
        response.writeHead(403).end();
        return;
      }
      const upstream = proxyRequest(
        target,
        { method: request.method, headers },
        (incoming) => {
          incoming.once("error", () => response.destroy());
          incoming.once("aborted", () => response.destroy());
          const output = {
            ...incoming.headers,
            "cache-control": "private, no-store",
          };
          delete output["set-cookie"];
          if (incoming.headers["set-cookie"] !== undefined)
            output["set-cookie"] = incoming.headers["set-cookie"].filter(
              (cookie) => !cookie.startsWith("logto_"),
            );
          const html =
            incoming.headers["content-type"]?.startsWith("text/html") &&
            request.method !== "HEAD";
          if (!html) {
            response.writeHead(incoming.statusCode ?? 502, output);
            incoming.pipe(response);
            return;
          }
          // Preserve streaming (including Next's Suspense/RSC payload). Append one external local
          // script after the application stream, with no session or credential in its source.
          delete output["content-length"];
          delete output["etag"];
          response.writeHead(incoming.statusCode ?? 502, output);
          incoming.pipe(response, { end: false });
          incoming.once("end", () =>
            response.end(
              '<script src="/__local/accounts/toolbar.js" defer></script>',
            ),
          );
        },
      );
      upstream.once("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end("Local web unavailable");
      });
      response.once("close", () => upstream.destroy());
      request.once("aborted", () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end("Локальная сессия недоступна. Повторите запрос.");
    }
  }
  // Next development HMR. Never accept foreign hosts or forward a caller's trust headers.
  server.on("upgrade", (request, socket, head) => {
    if (
      request.headers.host !== new URL(origin).host ||
      request.headers.origin !== origin
    ) {
      socket.destroy();
      return;
    }
    const upstream = connect(
      Number(upstreamUrl.port),
      upstreamUrl.hostname,
      () => {
        upstream.write(
          `${request.method} ${request.url} HTTP/1.1\r\nhost: ${upstreamUrl.host}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-key: ${String(request.headers["sec-websocket-key"] ?? "")}\r\nsec-websocket-version: 13\r\n\r\n`,
        );
        upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      },
    );
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  /** @type {Set<import("node:net").Socket>} */
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.listenHost ?? "127.0.0.1", () => {
      server.removeListener("error", reject);
      done(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Local gateway has no TCP address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}

/** @param {string | null | undefined} value */
function safeReturn(value) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/u.test(value) ||
    value.startsWith("/__local/")
  )
    return "/";
  return value;
}

/** @param {unknown} input */
export function validateLocalAccountsSettings(input) {
  return z
    .object({
      mode: z.literal("development"),
      endpoint: z.url().refine((value) => {
        const url = new URL(value);
        return (
          url.origin === "https://identity.inside.localhost:3301" &&
          url.pathname === "/" &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
      audience: z.url().refine(isLoopbackOrigin),
      webBaseUrl: z.url().refine(isLoopbackOrigin),
    })
    .parse(input);
}

/** @param {string} value */
function isLoopbackOrigin(value) {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.pathname === "/" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}
