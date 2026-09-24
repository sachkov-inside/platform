import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";

import {
  classifyEntryRoute,
  createEntryRateLimiter,
  ENTRY_RATE_WINDOW_SECONDS,
  entryClient,
  entryRequestsPerWindow,
  entryRoutePaths,
  limitEntryRequest,
  type EntryRateLimiter,
} from "@/_app/entry-rate-limit";
import type { WebRuntimeMode } from "@/shared/config/index.server";

import { config as proxyConfig, proxy } from "../../proxy";

const origin = "https://inside.example.test";
const client = "203.0.113.7";
const purchase = "/api/account/billing/purchase";

function request(path: string, forwardedFor: string, method = "POST"): Request {
  return new Request(`${origin}${path}`, { method, headers: { "x-forwarded-for": forwardedFor } });
}

function clock(start = 1_000_000) {
  let at = start;
  return {
    now: () => at,
    advanceSeconds: (seconds: number) => {
      at += seconds * 1_000;
    },
  };
}

/**
 * Отправляет на маршрут команды оплаты ровно на один запрос больше её предела. Адрес может меняться
 * от запроса к запросу.
 */
function overrunBillingCommand(
  limiter: EntryRateLimiter,
  path: string,
  { address = () => client, mode = "production" }: {
    readonly address?: (attempt: number) => string;
    readonly mode?: WebRuntimeMode;
  } = {},
) {
  return Array.from({ length: entryRequestsPerWindow["billing-command"] + 1 }, (_, attempt) =>
    limitEntryRequest(limiter, request(path, address(attempt)), mode));
}

/** Сравнивает matcher с перечнем ограничителя; пустой список — совпадение. */
function matcherDrift(matcher: readonly string[]): readonly string[] {
  const expected = new Set<string>(entryRoutePaths);
  const actual = new Set(matcher);
  return [
    ...[...expected].filter((path) => !actual.has(path)).map((path) => `missing ${path}`),
    ...[...actual].filter((path) => !expected.has(path)).map((path) => `unexpected ${path}`),
  ];
}

describe("entry rate limit", () => {
  it("answers 429 with Retry-After once one address exceeds its window", async () => {
    const time = clock();
    const limiter = createEntryRateLimiter(time.now);
    const outcomes = overrunBillingCommand(limiter, purchase);

    expect(outcomes.slice(0, -1).every((outcome) => outcome === undefined)).toBe(true);
    const limited = outcomes.at(-1);
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe(String(ENTRY_RATE_WINDOW_SECONDS));
    expect(limited?.headers.get("cache-control")).toBe("no-store, private");
    expect(await limited?.text()).toContain("Слишком много запросов");

    time.advanceSeconds(ENTRY_RATE_WINDOW_SECONDS - 15);
    expect(limitEntryRequest(limiter, request(purchase, client), "production")?.headers.get("retry-after"))
      .toBe("15");

    time.advanceSeconds(15);
    expect(limitEntryRequest(limiter, request(purchase, client), "production")).toBeUndefined();
  });

  it("counts each address and each route kind separately", () => {
    const limiter = createEntryRateLimiter(clock().now);
    overrunBillingCommand(limiter, "/api/account/billing/contact/start");

    expect(limitEntryRequest(limiter, request(purchase, client), "production")?.status).toBe(429);
    expect(limitEntryRequest(limiter, request(purchase, "198.51.100.4"), "production")).toBeUndefined();
    expect(limitEntryRequest(limiter, request("/auth/sign-in", client), "production")).toBeUndefined();
  });

  it("counts one IPv6 /64 as one client", () => {
    const limiter = createEntryRateLimiter(clock().now);
    const outcomes = overrunBillingCommand(limiter, purchase, {
      address: (attempt) => `2001:db8:0:1::${(attempt + 1).toString(16)}`,
    });

    expect(outcomes.at(-1)?.status).toBe(429);
    expect(limitEntryRequest(limiter, request(purchase, "2001:db8:0:2::1"), "production")).toBeUndefined();
  });

  it("keys on the first forwarded address and pools malformed values", () => {
    const key = (value?: string) =>
      entryClient(new Headers(value === undefined ? {} : { "x-forwarded-for": value })).key;

    expect(key("203.0.113.7, 10.0.0.2")).toBe(client);
    expect(key("::ffff:203.0.113.7")).toBe(client);
    expect(key("2001:DB8:0:1:aa:bb:cc:dd")).toBe("2001:db8:0:1::/64");
    expect(key("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(key("not-an-address")).toBe("unidentified");
    expect(key()).toBe("unidentified");
  });

  it("leaves loopback, non-production and unlisted requests alone", () => {
    const limiter = createEntryRateLimiter(clock().now);

    for (const loopback of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(overrunBillingCommand(limiter, purchase, { address: () => loopback })
        .every((outcome) => outcome === undefined)).toBe(true);
    }
    expect(overrunBillingCommand(limiter, purchase, { mode: "development" })
      .every((outcome) => outcome === undefined)).toBe(true);
    expect(classifyEntryRoute("GET", purchase)).toBeUndefined();
    expect(classifyEntryRoute("POST", "/api/account/billing/subscription/cancel")).toBeUndefined();
    expect(classifyEntryRoute("POST", "/callback")).toBeUndefined();
    expect(classifyEntryRoute("GET", "/callback")).toBe("sign-in");
    expect(classifyEntryRoute("HEAD", "/communications/visit")).toBe("public-link");
    expect(classifyEntryRoute("POST", "/api/web-vitals")).toBe("client-report");
  });

  it("evicts the oldest window once the table is full", () => {
    const limiter = createEntryRateLimiter(clock().now);
    overrunBillingCommand(limiter, purchase);

    for (let index = 0; index < 10_000; index += 1) {
      limiter.take("public-link", ["198.51", String(Math.floor(index / 256)), String(index % 256)].join("."));
    }
    // Самое старое окно вытеснено первым: счёт для исходного адреса начался заново.
    expect(limitEntryRequest(limiter, request(purchase, client), "production")).toBeUndefined();
  });

  it("matches exactly the routes the limiter classifies", () => {
    expect(matcherDrift(proxyConfig.matcher)).toEqual([]);
    expect(matcherDrift(proxyConfig.matcher.filter((path) => path !== "/callback")))
      .toEqual(["missing /callback"]);
    expect(matcherDrift([...proxyConfig.matcher, "/api/account"])).toEqual(["unexpected /api/account"]);
    for (const path of entryRoutePaths) {
      const kinds = ["GET", "HEAD", "POST"].map((method) => classifyEntryRoute(method, path));
      expect(kinds.some((kind) => kind !== undefined), path).toBe(true);
    }
  });

  it("passes an allowed request on to the route", () => {
    const response = proxy(new NextRequest(`${origin}/auth/sign-in`, { method: "POST" }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
