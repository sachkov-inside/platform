import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { hasLogtoSessionCookie } from "./logto-bff-config.server";

export async function getOptionalPlatformAccessToken(
  request?: Request,
): Promise<string | undefined> {
  return request === undefined
    ? getOptionalPlatformAccessTokenRsc()
    : resolveOptionalPlatformAccessToken(request);
}

/**
 * Чтение сессии в рендере принадлежит запросу, а не предзагрузке: `connection()` останавливает
 * предзагрузку раньше, чем она дойдёт до обновления токена. Иначе её зависшее обновление попало бы
 * в общую карту `refreshFlights`, и настоящий запрос той же сессии получил бы его отказ (ADR 0027).
 */
const getOptionalPlatformAccessTokenRsc = cache(async () => {
  await connection();
  return resolveOptionalPlatformAccessToken();
});

async function resolveOptionalPlatformAccessToken(
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

  const {
    getPlatformAccessToken,
    getPlatformAccessTokenRsc,
    LogtoSessionUnavailableError,
  } = await import("./platform-access-token.server");
  try {
    return request === undefined
      ? await getPlatformAccessTokenRsc(config)
      : await getPlatformAccessToken(config);
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return undefined;
    }
    throw error;
  }
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
