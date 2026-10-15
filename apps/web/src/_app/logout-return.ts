import { NextResponse, type NextRequest } from "next/server";

/** Navigation intent only: logout still returns through the IdP's registered root URI. */
export function consumeLogoutReturn(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname !== "/") return null;
  const saved = request.cookies.get("inside.logout-return")?.value;
  if (saved === undefined) return null;
  let response = NextResponse.next();
  try {
    const target = new URL(decodeURIComponent(saved), request.url);
    if (target.origin === request.nextUrl.origin)
      response = NextResponse.redirect(target, 303);
  } catch {
    /* Invalid navigation metadata cannot authenticate or redirect. */
  }
  response.headers.set("cache-control", "no-store, private");
  response.cookies.set("inside.logout-return", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
