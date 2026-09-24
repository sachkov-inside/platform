import { NextResponse, type NextRequest } from "next/server";

import { isLegalPagePath } from "@/_pages/legal.address";

/** Адрес без маршрута: на него Next.js отвечает своим 404 (ADR 0027, «Настоящий 404 до начала ответа»). */
const UNROUTED_PATH = "/_unrouted";

/**
 * Неизвестный адрес раздела документов отвечает 404 с первого захода: страница с параметром
 * стримится, и её `notFound()` пришёл бы после статуса 200 (#701). Опубликованный адрес проходит
 * к своей статической странице без изменений.
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  if (isLegalPagePath(request.nextUrl.pathname)) return undefined;
  return NextResponse.rewrite(new URL(UNROUTED_PATH, request.url));
}

export const config = {
  matcher: "/legal/:path+",
};
