import { NextResponse, type NextRequest } from "next/server";

import { isLegalPagePath } from "./src/_pages/legal.address";
import {
  createEntryRateLimiter,
  limitEntryRequest,
} from "./src/_app/entry-rate-limit";
import { readWebRuntimeMode } from "./src/shared/config/index.server";

/** Один счётчик на процесс web: production запускает ровно один экземпляр (ADR 0028). */
const entryRateLimiter = createEntryRateLimiter();

/** Адрес без маршрута: на него Next.js отвечает своим 404 (ADR 0027, «Настоящий 404 до начала ответа»). */
const UNROUTED_PATH = "/_unrouted";

/**
 * Неизвестный адрес раздела документов отвечает 404 с первого захода: страница с параметром
 * стримится, и её `notFound()` пришёл бы после статуса 200 (#701). Остальные адреса из `matcher` —
 * входные маршруты, и их проверяет ограничитель частоты.
 */
export function proxy(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/legal/") && !isLegalPagePath(pathname)) {
    return NextResponse.rewrite(new URL(UNROUTED_PATH, request.url));
  }
  return (
    limitEntryRequest(entryRateLimiter, request, readWebRuntimeMode()) ??
    NextResponse.next()
  );
}

/**
 * Входные маршруты совпадают с `entryRoutePaths`, и `entry-rate-limit.test.ts` сверяет оба перечня.
 * Последний элемент — раздел документов, его адреса известны web целиком.
 */
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
    "/api/web-vitals",
    "/api/render-errors",
    "/legal/:path+",
  ],
};
