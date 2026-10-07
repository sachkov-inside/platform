import "server-only";
import { connection } from "next/server";
import type {
  AuthenticatedReadFailure,
  AuthenticatedReadResult,
} from "@/shared/api/authenticated-read";
import {
  LogtoSessionUnavailableError,
  sessionAdapter,
  type SessionReadMode,
} from "./session-adapter.server";

export async function readAuthenticatedSession(
  mode: SessionReadMode,
): Promise<AuthenticatedReadResult<string>> {
  // Keep Next.js's prefetch interruption outside the dependency failure boundary (ADR 0027).
  if (mode === "rsc") await connection();
  try {
    return { kind: "ready", value: await sessionAdapter.accessToken(mode) };
  } catch (error) {
    return {
      kind:
        error instanceof LogtoSessionUnavailableError
          ? "authentication_required"
          : "identity_unavailable",
    };
  }
}

/** Reads one authenticated capability; feature code owns its response schema. */
export async function handleAuthenticatedRead(
  execute: (accessToken: string) => Promise<Response>,
): Promise<Response> {
  const session = await readAuthenticatedSession("route");
  if (session.kind !== "ready") return readFailureResponse(session);
  try {
    const response = await execute(session.value);
    if (response.status === 401 || response.status === 503) {
      return readFailureResponse(
        {
          kind:
            response.status === 401
              ? "authentication_required"
              : "dependency_unavailable",
        },
        response.headers,
      );
    }
    return privateReadResponse(response);
  } catch {
    return readFailureResponse({ kind: "dependency_unavailable" });
  }
}

function readFailureResponse(
  failure: AuthenticatedReadFailure,
  headers?: Headers,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.set("content-type", "application/json");
  return privateReadResponse(
    Response.json(failure, {
      headers: responseHeaders,
      status: failure.kind === "authentication_required" ? 401 : 503,
    }),
  );
}

function privateReadResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, private");
  const vary = headers.get("vary");
  if (vary === null) headers.set("vary", "cookie");
  else if (
    !vary
      .toLowerCase()
      .split(",")
      .some((value) => value.trim() === "cookie")
  ) {
    headers.set("vary", `${vary}, cookie`);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
