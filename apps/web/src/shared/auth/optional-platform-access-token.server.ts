import "server-only";

import { cookies } from "next/headers";

import { hasLogtoSessionCookie } from "./logto-bff-config.server";

export async function getOptionalPlatformAccessToken(
  request?: Request,
): Promise<string | undefined> {
  const cookieNames =
    request === undefined
      ? (await cookies()).getAll().map(({ name }) => name)
      : cookieNamesFromHeader(request.headers.get("cookie"));
  if (!hasLogtoSessionCookie(cookieNames)) {
    return undefined;
  }

  const [{ getPlatformAccessToken }, { readLogtoBffConfig }] =
    await Promise.all([
      import("./platform-access-token.server"),
      import("./logto-bff-config.server"),
    ]);
  return getPlatformAccessToken(readLogtoBffConfig());
}

function cookieNamesFromHeader(header: string | null): string[] {
  if (header === null) {
    return [];
  }
  return header
    .split(";")
    .map((cookie) => cookie.trim().split("=", 1)[0])
    .filter((name): name is string => name !== undefined && name.length > 0);
}
