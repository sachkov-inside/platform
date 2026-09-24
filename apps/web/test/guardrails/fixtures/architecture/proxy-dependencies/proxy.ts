import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { catalogAddressExists } from "./catalog-address";

/** Нарушение: proxy спрашивает backend и читает сессию до ответа. */
export async function proxy(request: NextRequest): Promise<NextResponse | undefined> {
  await cookies();
  if (await catalogAddressExists(request.nextUrl.pathname)) return undefined;
  return NextResponse.rewrite(new URL("/_unrouted", request.url));
}

export const config = { matcher: "/materials/:slug" };
