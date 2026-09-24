import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";

import {
  classifyEntryRoute,
  createEntryRateLimiter,
  ENTRY_RATE_WINDOW_SECONDS,
  entryClientAddress,
  entryRequestsPerWindow,
  entryRoutePaths,
  limitEntryRequest,
} from "@/shared/http/entry-rate-limit";

import { config as proxyConfig, proxy } from "../../proxy";

const origin = "https://inside.example.test";
const client = "203.0.113.7";

function request(path: string, init: { method?: string; forwardedFor?: string } = {}): Request {
  return new Request(`${origin}${path}`, {
    method: init.method ?? "POST",
    headers: init.forwardedFor === undefined ? {} : { "x-forwarded-for": init.forwardedFor },
  });
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

function exhaust(limiter: ReturnType<typeof createEntryRateLimiter>, path: string, address = client) {
  const outcomes = [];
  for (let attempt = 0; attempt <= entryRequestsPerWindow.payment; attempt += 1) {
    outcomes.push(limitEntryRequest(limiter, request(path, { forwardedFor: address }), "production"));
  }
  return outcomes;
}

describe("entry rate limit", () => {
  it("answers 429 with Retry-After once one address exceeds its window", async () => {
    const time = clock();
    const limiter = createEntryRateLimiter(time.now);
    const outcomes = exhaust(limiter, "/api/account/billing/purchase");

    expect(outcomes.slice(0, entryRequestsPerWindow.payment)).toEqual(
      Array.from({ length: entryRequestsPerWindow.payment }, () => undefined),
    );
    const limited = outcomes.at(-1);
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe(String(ENTRY_RATE_WINDOW_SECONDS));
    expect(limited?.headers.get("cache-control")).toBe("no-store, private");
    expect(await limited?.text()).toContain("Слишком много запросов");

    time.advanceSeconds(ENTRY_RATE_WINDOW_SECONDS - 15);
    const stillLimited = limitEntryRequest(
      limiter,
      request("/api/account/billing/purchase", { forwardedFor: client }),
      "production",
    );
    expect(stillLimited?.headers.get("retry-after")).toBe("15");

    time.advanceSeconds(15);
    expect(
      limitEntryRequest(limiter, request("/api/account/billing/purchase", { forwardedFor: client }), "production"),
    ).toBeUndefined();
  });

  it("counts each address and each route kind separately", () => {
    const limiter = createEntryRateLimiter(clock().now);
    exhaust(limiter, "/api/account/billing/contact/start");

    expect(
      limitEntryRequest(limiter, request("/api/account/billing/purchase", { forwardedFor: client }), "production")
        ?.status,
    ).toBe(429);
    expect(
      limitEntryRequest(
        limiter,
        request("/api/account/billing/purchase", { forwardedFor: "198.51.100.4" }),
        "production",
      ),
    ).toBeUndefined();
    expect(limitEntryRequest(limiter, request("/auth/sign-in", { forwardedFor: client }), "production"))
      .toBeUndefined();
  });

  it("keys on the first forwarded address and pools malformed values", () => {
    expect(entryClientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" }))).toBe(client);
    expect(entryClientAddress(new Headers({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
    expect(entryClientAddress(new Headers({ "x-forwarded-for": "not-an-address" }))).toBe("unidentified");
    expect(entryClientAddress(new Headers())).toBe("unidentified");
  });

  it("leaves loopback, non-production and unlisted requests alone", () => {
    const limiter = createEntryRateLimiter(clock().now);

    for (const loopback of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(exhaust(limiter, "/api/account/billing/purchase", loopback).every((outcome) => outcome === undefined))
        .toBe(true);
    }
    for (let attempt = 0; attempt <= entryRequestsPerWindow.payment; attempt += 1) {
      expect(
        limitEntryRequest(
          limiter,
          request("/api/account/billing/purchase", { forwardedFor: client }),
          "development",
        ),
      ).toBeUndefined();
    }
    expect(classifyEntryRoute("GET", "/api/account/billing/purchase")).toBeUndefined();
    expect(classifyEntryRoute("POST", "/callback")).toBeUndefined();
    expect(classifyEntryRoute("GET", "/callback")).toBe("sign-in");
    expect(classifyEntryRoute("HEAD", "/communications/visit")).toBe("public-link");
  });

  it("evicts the oldest window once the table is full", () => {
    const time = clock();
    const limiter = createEntryRateLimiter(time.now);
    exhaust(limiter, "/api/account/billing/purchase");

    for (let index = 0; index < 10_000; index += 1) {
      limiter.take("public-link", ["198.51", String(Math.floor(index / 256)), String(index % 256)].join("."));
    }
    // Самое старое окно вытеснено первым: счёт для исходного адреса начался заново.
    expect(
      limitEntryRequest(limiter, request("/api/account/billing/purchase", { forwardedFor: client }), "production"),
    ).toBeUndefined();
  });

  it("matches exactly the routes the limiter classifies", () => {
    expect([...proxyConfig.matcher].sort()).toEqual([...entryRoutePaths].sort());
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
