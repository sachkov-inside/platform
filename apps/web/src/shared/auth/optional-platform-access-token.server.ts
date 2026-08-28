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
  const { readLogtoBffConfig } = await import("./logto-bff-config.server");
  const config = readLogtoBffConfig();
  if (!hasLogtoSessionCookie(cookieNames, config.appId)) {
    return undefined;
  }

  const { getPlatformAccessToken, getPlatformAccessTokenRsc } = await import(
    "./platform-access-token.server"
  );
  return request === undefined
    ? getPlatformAccessTokenRsc(config)
    : getPlatformAccessToken(config);
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
