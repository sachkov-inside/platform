import "server-only";
import { createHmac } from "node:crypto";
import { currentLegalEdition } from "@inside/legal";
import { z } from "zod";
import { entryClient } from "@/shared/lib/ingress-client";
import {
  requestReaderReference,
  resolveAccount,
} from "@/shared/api/backend/index.server";
import {
  handleOptionalMutationOperation,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";
import { analyticsPaths } from "../model/analytics-contract";
import { captureAnalyticsOperation } from "./analytics.operation";

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

/** The declared optional operation owns Origin, JSON parsing, size and session admission. */
export function handleAnalyticsCapture(request: Request): Promise<Response> {
  return handleOptionalMutationOperation(request, captureAnalyticsOperation, {
    invalidInput: () => new Response(null, { status: 400 }),
    execute: async (event, accessToken) => {
      const config = configuration();
      const response = (status: number) =>
        status === 204
          ? Response.json({ accepted: true }, { headers })
          : new Response(null, { status, headers });
      if (config === undefined)
        return Response.json({ accepted: false }, { headers });
      if (event.revision !== config.INSIDE_ANALYTICS_LEGAL_REVISION)
        return response(400);
      const base = readLogtoBffConfig().baseUrl;
      const digest = (scope: string, value: string) =>
        createHmac("sha256", config.INSIDE_ANALYTICS_PSEUDONYM_SECRET)
          .update(`${scope}:${value}`)
          .digest("hex");
      let id: string | undefined;
      if (accessToken !== undefined) {
        try {
          id = digest(
            "inside.analytics.account.v1",
            (await resolveAccount(accessToken)).accountId,
          );
        } catch {
          return response(503);
        }
      }
      const entityKind =
        event.event === "material_view" || event.event === "access_restricted"
          ? "material"
          : "product";
      let entity: string;
      try {
        const owned = await requestReaderReference(
          entityKind,
          event.entityId,
          accessToken,
        );
        if (!owned.ok)
          return response(owned.response.status === 404 ? 400 : 503);
        const reference = z
          .strictObject({
            id: z.uuid(),
            kind: z.enum(["product", "material"]),
            availability: z.enum(["available", "locked"]),
          })
          .safeParse(owned.body);
        if (
          !reference.success ||
          reference.data.id !== event.entityId.toLowerCase() ||
          reference.data.kind !== entityKind
        )
          return response(503);
        // A browser cannot turn a locked metadata projection into an observation of its body.
        if (
          event.event === "material_view" &&
          reference.data.availability !== "available"
        )
          return response(400);
        entity = reference.data.id;
      } catch {
        return response(503);
      }
      // Rebuild only native UTM fields from closed codes. No original query or referrer survives.
      const nativeQuery = new URLSearchParams({
        utm_source: event.campaign,
        utm_medium: event.referrer,
      });
      const url =
        analyticsPaths[event.event].replace(":entityId", entity) +
        "?" +
        nativeQuery.toString();

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
              url,
              data: {
                observation: "browser",
                event: event.event,
                campaign: event.campaign,
                referrer: event.referrer,
              },
              // Existing ingress boundary validates addresses and coarsens IPv6 to its /64 key.
              // Raw input is transient in the private native detector, never logged or returned.
              ip: entryClient(request.headers).key,
              userAgent: (request.headers.get("user-agent") ?? "").slice(
                0,
                512,
              ),
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
    },
  });
}
