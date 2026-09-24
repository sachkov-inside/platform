import { NextResponse, type NextRequest } from "next/server";

import {
  createEntryRateLimiter,
  limitEntryRequest,
} from "./src/shared/http/entry-rate-limit";

/** Один счётчик на процесс web: production запускает ровно один экземпляр (ADR 0028). */
const entryRateLimiter = createEntryRateLimiter();

export function proxy(request: NextRequest): Response {
  return limitEntryRequest(entryRateLimiter, request, process.env.NODE_ENV) ?? NextResponse.next();
}

/** Совпадает с `entryRoutePaths`; `entry-rate-limit.test.ts` сверяет оба перечня. */
export const config = {
  matcher: [
    "/auth/sign-in",
    "/callback",
    "/communications/visit",
    "/api/account/billing/purchase",
    "/api/account/billing/payment-method/change",
    "/api/account/billing/subscription/change",
    "/api/account/billing/contact/start",
    "/api/account/billing/contact/confirm",
  ],
};
