import "server-only";

import { createHash } from "node:crypto";

import {
  getAccessToken,
  getAccessTokenRSC,
} from "@logto/next/server-actions";
import { cookies } from "next/headers";

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

export async function getPlatformAccessToken(
  config: ResolvedLogtoBffConfig,
): Promise<string> {
  return getPlatformAccessTokenWith(config, "mutable", getAccessToken);
}

export async function getPlatformAccessTokenRsc(
  config: ResolvedLogtoBffConfig,
): Promise<string> {
  return getPlatformAccessTokenWith(config, "rsc", getAccessTokenRSC);
}

async function getPlatformAccessTokenWith(
  config: ResolvedLogtoBffConfig,
  mode: "mutable" | "rsc",
  readAccessToken: typeof getAccessToken,
): Promise<string> {
  const session = (await cookies()).get(logtoSessionCookieName(config.appId))?.value;
  if (session === undefined) {
    throw new LogtoSessionUnavailableError();
  }
  const flightKey = `${mode}:${createHash("sha256").update(session).digest("hex")}`;
  const active = refreshFlights.get(flightKey);
  if (active !== undefined) {
    return active;
  }

  const pending = readAccessToken(config, config.audience)
    .catch((error: unknown) => {
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

function isNotAuthenticated(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "LogtoClientError" &&
    "code" in error &&
    error.code === "not_authenticated"
  );
}
