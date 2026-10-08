import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";

/**
 * The separate HTTP backend owns the UTC clock that evaluates live access fixtures.
 * Capture its instant once; never substitute the browser runner's calendar.
 */
export async function backendFixtureInstant(
  request: APIRequestContext,
  backendBaseUrl = z
    .url()
    .parse(
      process.env["FULLSTACK_API_BASE_URL"] ?? process.env["BACKEND_BASE_URL"],
    ),
): Promise<string> {
  const response = await request.get(new URL("/health", backendBaseUrl).href);
  // Minimal fixtures may omit readiness dependencies; both health statuses carry backend UTC.
  if (response.status() !== 200 && response.status() !== 503) {
    throw new Error(
      `Backend clock request failed: ${String(response.status())}`,
    );
  }
  const header = z.string().min(1).parse(response.headers()["date"]);
  return z.coerce.date().parse(header).toISOString();
}
