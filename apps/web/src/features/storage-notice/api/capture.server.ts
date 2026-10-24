import "server-only";
import { createHmac } from "node:crypto";
import { currentLegalEdition } from "@inside/legal";
import { z } from "zod";
import { entryClient } from "@/shared/lib/ingress-client";
import { resolveAccount } from "@/shared/api/backend/index.server";
import {
  isSameOriginMutation,
  readAuthenticatedSession,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";
import {
  analyticsCaptureSchema,
  analyticsPaths,
} from "../model/analytics-contract";

const ANALYTICS_MAX_BYTES = 1024;
const ANALYTICS_EXPORT_TIMEOUT_MILLISECONDS = 1000;
const configurationSchema = z.object({
  INSIDE_ANALYTICS_ENABLED: z.literal("true"),
  INSIDE_ANALYTICS_LEGAL_REVISION: z.string(),
  // Deliberately fixed to the private, owned service. This is never a general proxy.
  INSIDE_UMAMI_ENDPOINT: z.literal("http://umami-ingest:3000/api/send"),
  INSIDE_UMAMI_WEBSITE_ID: z.uuid(),
  INSIDE_ANALYTICS_PSEUDONYM_SECRET: z.string().min(32).max(256),
});
function configuration() {
  const parsed = configurationSchema.safeParse(process.env);
  const edition = currentLegalEdition("cookies").version;
  if (
    !parsed.success ||
    edition < 3 ||
    parsed.data.INSIDE_ANALYTICS_LEGAL_REVISION !== String(edition)
  )
    return undefined;
  return parsed.data;
}
const headers = { "cache-control": "no-store, private", vary: "cookie" };
export function handleAnalyticsConfig(): Response {
  const config = configuration();
  return Response.json(
    config === undefined
      ? { enabled: false }
      : { enabled: true, revision: config.INSIDE_ANALYTICS_LEGAL_REVISION },
    { headers },
  );
}

/** Guest report boundary: same Origin, bounded closed schema, no arbitrary transport or identity. */
export async function handleAnalyticsCapture(
  request: Request,
): Promise<Response> {
  const response = (status: number) =>
    status === 204
      ? Response.json({ accepted: true }, { headers })
      : new Response(null, { status, headers });
  const base = readLogtoBffConfig().baseUrl;
  if (!isSameOriginMutation(request, base)) return response(403);
  const config = configuration();
  if (config === undefined)
    return Response.json({ accepted: false }, { headers });
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return response(400);
  if (Number(request.headers.get("content-length")) > ANALYTICS_MAX_BYTES)
    return response(413);
  let text = "";
  if (request.body !== null) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        break;
      }
      length += chunk.value.byteLength;
      if (length > ANALYTICS_MAX_BYTES) {
        await reader.cancel();
        return response(413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return response(400);
  }
  const parsed = analyticsCaptureSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.revision !== config.INSIDE_ANALYTICS_LEGAL_REVISION
  )
    return response(400);
  // Resolve on every request. Never keep Umami cache tokens, Account bindings or browser IDs.
  const session = await readAuthenticatedSession("route");
  if (session.kind === "identity_unavailable") return response(503);
  let id: string | undefined;
  if (session.kind === "ready") {
    try {
      const account = await resolveAccount(session.value);
      id = createHmac("sha256", config.INSIDE_ANALYTICS_PSEUDONYM_SECRET)
        .update(`inside.analytics.account.v1:${account.accountId}`)
        .digest("hex");
    } catch {
      return response(503);
    }
  }
  const event = parsed.data;
  try {
    const result = await fetch(config.INSIDE_UMAMI_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(ANALYTICS_EXPORT_TIMEOUT_MILLISECONDS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "event",
        payload: {
          website: config.INSIDE_UMAMI_WEBSITE_ID,
          hostname: new URL(base).hostname,
          url: analyticsPaths[event.event],
          data: {
            observation: "browser",
            event: event.event,
            campaign: event.campaign,
            referrer: event.referrer,
          },
          // Existing ingress boundary validates addresses and coarsens IPv6 to its /64 key.
          // Raw input is transient in the private native detector, never logged or returned.
          ip: entryClient(request.headers).key,
          userAgent: (request.headers.get("user-agent") ?? "").slice(0, 512),
          ...(id === undefined ? {} : { id }),
        },
      }),
    });
    // Dispose the native response without forwarding its session/cache token to the browser.
    await result.body?.cancel();
    return response(result.ok ? 204 : 503);
  } catch {
    return response(503);
  }
}
