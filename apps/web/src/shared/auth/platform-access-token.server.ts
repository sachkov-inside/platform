import "server-only";

import { createHash } from "node:crypto";

import { getAccessToken, getAccessTokenRSC } from "@logto/next/server-actions";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";

import { clearLogtoSessionCookie } from "./clear-logto-session-cookie.server";
import {
  logtoSessionCookieName,
  type ResolvedLogtoBffConfig,
} from "./logto-bff-config.server";

const refreshFlights = new Map<string, Promise<string>>();

export class LogtoSessionUnavailableError extends Error {
  constructor() {
    super("Logto session is unavailable");
    this.name = "LogtoSessionUnavailableError";
  }
}

/** Провайдер отверг refresh grant: сессия кончилась окончательно, и её cookie больше не нужна. */
class RejectedRefreshGrantError extends LogtoSessionUnavailableError {}

export async function getPlatformAccessToken(
  config: ResolvedLogtoBffConfig,
): Promise<string> {
  return getPlatformAccessTokenWith(config, "mutable", getAccessToken);
}

export async function getPlatformAccessTokenRsc(
  config: ResolvedLogtoBffConfig,
): Promise<string> {
  // Рендер с сессией принадлежит запросу: предзагрузка останавливается здесь и не заводит
  // обновление токена, которое делила бы с настоящим запросом (ADR 0027).
  await connection();
  return getPlatformAccessTokenWith(config, "rsc", getAccessTokenRSC);
}

async function getPlatformAccessTokenWith(
  config: ResolvedLogtoBffConfig,
  mode: "mutable" | "rsc",
  readAccessToken: typeof getAccessToken,
): Promise<string> {
  const session = (await cookies()).get(
    logtoSessionCookieName(config.appId),
  )?.value;
  if (session === undefined) {
    throw new LogtoSessionUnavailableError();
  }
  const flightKey = `${mode}:${createHash("sha256").update(session).digest("hex")}`;
  try {
    return await (refreshFlights.get(flightKey) ??
      startRefreshFlight(config, flightKey, readAccessToken));
  } catch (error) {
    // Общий полёт обновления выполняется в области первого запроса; cookie каждый запрос
    // снимает в своей. Режим `rsc` cookie не пишет, потому что рендер Server Component её
    // менять не может: её снимет следующий обработчик маршрута, например `/auth/status`.
    if (error instanceof RejectedRefreshGrantError && mode === "mutable") {
      await clearLogtoSessionCookie(config);
    }
    throw error;
  }
}

function startRefreshFlight(
  config: ResolvedLogtoBffConfig,
  flightKey: string,
  readAccessToken: typeof getAccessToken,
): Promise<string> {
  const pending = readAccessToken(config, config.audience)
    .catch((error: unknown) => {
      if (isRejectedRefreshGrant(error)) {
        throw new RejectedRefreshGrantError();
      }
      if (isNotAuthenticated(error)) {
        throw new LogtoSessionUnavailableError();
      }
      throw error;
    })
    .finally(() => {
      if (refreshFlights.get(flightKey) === pending) {
        refreshFlights.delete(flightKey);
      }
    });
  refreshFlights.set(flightKey, pending);
  return pending;
}

const oauthInvalidGrantSchema = z.object({ error: z.literal("invalid_grant") });

/**
 * SDK по-разному оборачивает отказ token endpoint (#1005). Fork Logto отвечает с `code` и
 * `message`, и SDK бросает `LogtoRequestError` с кодом `oidc.invalid_grant`. Ответ OAuth 2.0 без
 * них SDK бросает как `LogtoError` `unexpected_response_error` с телом в `data`. Сеть, сбой
 * провайдера и другие коды OAuth сюда не попадают: сессия остаётся.
 */
function isRejectedRefreshGrant(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  if (error.name === "LogtoRequestError") {
    return error.code === "oidc.invalid_grant";
  }
  return (
    error.name === "LogtoError" &&
    error.code === "unexpected_response_error" &&
    "data" in error &&
    oauthInvalidGrantSchema.safeParse(error.data).success
  );
}

function isNotAuthenticated(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "LogtoClientError" &&
    "code" in error &&
    error.code === "not_authenticated"
  );
}
