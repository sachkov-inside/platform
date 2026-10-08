import { z } from "zod";
import type { AuthenticatedReadResult } from "./authenticated-read";

const readFailureSchema = z.object({
  kind: z.enum([
    "authentication_required",
    "identity_unavailable",
    "dependency_unavailable",
  ]),
});

/** The browser half of the authenticated read protocol; feature schemas validate ready values. */
export async function requestAuthenticatedRead(
  url: string,
  signal?: AbortSignal,
): Promise<AuthenticatedReadResult<unknown>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    const reference = response.headers.get("x-correlation-id");
    const diagnostic = reference === null ? {} : { reference };
    if (response.status === 401)
      return { kind: "authentication_required", ...diagnostic };
    if (response.ok)
      return { kind: "ready", value: (await response.json()) as unknown };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "dependency_unavailable", ...diagnostic };
    }
    const failure = readFailureSchema.safeParse(body);
    if (failure.success) return { ...failure.data, ...diagnostic };
    return { kind: "rejected", status: response.status, body, ...diagnostic };
  } catch {
    return { kind: "dependency_unavailable" };
  }
}
