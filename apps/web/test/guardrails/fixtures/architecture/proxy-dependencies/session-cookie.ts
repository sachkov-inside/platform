import type { NextRequest } from "next/server";

/** Нарушение без импорта: сессия прочитана из cookie самого запроса. */
export function hasSessionCookie(request: NextRequest): boolean {
  request.cookies.get("inside.logout-return");
  return request.cookies.has("logto");
}
