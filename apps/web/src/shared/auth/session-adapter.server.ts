import "server-only";

import { readLogtoBffConfig } from "./logto-bff-config.server";
import {
  getPlatformAccessToken,
  getPlatformAccessTokenRsc,
} from "./platform-access-token.server";

export { LogtoSessionUnavailableError } from "./platform-access-token.server";
export type SessionReadMode = "route" | "rsc";

/** Public session seam: tests replace this adapter instead of Logto internals. */
export const sessionAdapter = {
  accessToken(mode: SessionReadMode): Promise<string> {
    const config = readLogtoBffConfig();
    return mode === "rsc"
      ? getPlatformAccessTokenRsc(config)
      : getPlatformAccessToken(config);
  },
  baseUrl(): string {
    return readLogtoBffConfig().baseUrl;
  },
};
