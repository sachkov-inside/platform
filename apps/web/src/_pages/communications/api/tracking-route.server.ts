import "server-only";
import { z } from "zod";
import { requestCommunicationVisit } from "@/shared/api/backend/index.server";
const headers = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};
const resolved = z.object({ kind: z.literal("resolved"), safeUrl: z.url() });
export function classifyTrackingTraffic(
  userAgent: string | null,
): "unknown" | "known_automation" {
  // Only named preview/crawler agents; an unrecognised or forged agent proves no human identity.
  return /TelegramBot|facebookexternalhit|Twitterbot|Slackbot-LinkExpanding|Discordbot|Googlebot|bingbot/iu.test(
    userAgent ?? "",
  )
    ? "known_automation"
    : "unknown";
}
export async function handleTrackingVisit(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/u.test(token))
    return new Response("Ссылка недействительна.", { status: 404, headers });
  try {
    const response = await requestCommunicationVisit({
      token,
      traffic: classifyTrackingTraffic(request.headers.get("user-agent")),
    });
    const parsed = response.ok ? resolved.safeParse(response.body) : null;
    if (parsed?.success)
      return new Response(null, {
        status: 302,
        headers: { ...headers, location: parsed.data.safeUrl },
      });
    const missing =
      response.ok &&
      z.object({ kind: z.literal("not_found") }).safeParse(response.body)
        .success;
    return new Response(
      missing
        ? "Ссылка не найдена."
        : "Переход временно недоступен. Попробуйте ещё раз.",
      { status: missing ? 404 : 503, headers },
    );
  } catch {
    return new Response("Переход временно недоступен. Попробуйте ещё раз.", {
      status: 503,
      headers,
    });
  }
}
export function handleTrackingHead() {
  return new Response(null, {
    status: 405,
    headers: { ...headers, allow: "GET" },
  });
}
