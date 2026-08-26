import { cookies } from "next/headers";

import {
  logtoSessionCookieName,
  type ResolvedLogtoBffConfig,
} from "./logto-bff-config.server";

export async function clearLogtoSessionCookie(
  config: Pick<ResolvedLogtoBffConfig, "appId" | "cookieSecure">,
): Promise<void> {
  (await cookies()).set(logtoSessionCookieName(config.appId), "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: config.cookieSecure,
    expires: new Date(0),
    maxAge: 0,
  });
}
