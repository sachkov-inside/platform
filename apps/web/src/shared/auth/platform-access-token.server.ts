import "server-only";

import { createHash } from "node:crypto";

import { getAccessToken } from "@logto/next/server-actions";
import { cookies } from "next/headers";

import {
  logtoSessionCookieName,
  type ResolvedLogtoBffConfig,
} from "./logto-bff-config.server";

const refreshFlights = new Map<string, Promise<string>>();

export async function getPlatformAccessToken(
  config: ResolvedLogtoBffConfig,
): Promise<string> {
  const session = (await cookies()).get(logtoSessionCookieName(config.appId))?.value;
  if (session === undefined) {
    throw new Error("Logto session is unavailable");
  }
  const flightKey = createHash("sha256").update(session).digest("hex");
  const active = refreshFlights.get(flightKey);
  if (active !== undefined) {
    return active;
  }

  const pending = getAccessToken(config, config.audience).finally(() => {
    if (refreshFlights.get(flightKey) === pending) {
      refreshFlights.delete(flightKey);
    }
  });
  refreshFlights.set(flightKey, pending);
  return pending;
}
