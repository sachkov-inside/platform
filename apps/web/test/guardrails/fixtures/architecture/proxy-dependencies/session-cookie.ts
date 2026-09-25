import type { NextRequest } from "next/server";

/** Нарушение без импорта: сессия прочитана из cookie самого запроса. */
export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.has("logto");
}
