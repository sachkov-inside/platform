import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { catalogAddressExists } from "./catalog-address";
import { topicAddressExists } from "./direct-fetch";
import { hasSessionCookie } from "./session-cookie";

/** Нарушение: proxy спрашивает backend и читает сессию до ответа. */
export async function proxy(request: NextRequest): Promise<NextResponse | undefined> {
  await cookies();
  if (hasSessionCookie(request)) return undefined;
  if (await catalogAddressExists(request.nextUrl.pathname)) return undefined;
  if (await topicAddressExists(request.nextUrl.pathname)) return undefined;
  return NextResponse.rewrite(new URL("/_unrouted", request.url));
}

export const config = { matcher: "/materials/:slug" };
