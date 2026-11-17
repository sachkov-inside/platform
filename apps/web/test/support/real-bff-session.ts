import "next/dist/server/node-environment";

import { PersistKey, wrapSession } from "@logto/node";
import { NextRequest } from "next/server";
import { createRequestStoreForAPI } from "next/dist/server/async-storage/request-store";
import { createWorkStore } from "next/dist/server/async-storage/work-store";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { vi } from "vitest";

const appId = "web-module-integration";
const cookieSecret = "web-module-integration-cookie-secret";
const audience = "https://platform-api.example.test";

/** Real encrypted provider session and Next request storage, without replacing Web auth modules. */
export async function realBffSession(token: string | null = "trusted-token") {
  vi.stubEnv("WEB_BASE_URL", "https://inside.example.test");
  vi.stubEnv("BACKEND_BASE_URL", audience);
  vi.stubEnv("LOGTO_ENDPOINT", "https://identity.example.test");
  vi.stubEnv("LOGTO_AUDIENCE", audience);
  vi.stubEnv("LOGTO_APP_ID", appId);
  vi.stubEnv("LOGTO_APP_SECRET", "module-confidential-app-secret");
  vi.stubEnv("LOGTO_COOKIE_SECRET", cookieSecret);
  const cookie =
    token === null
      ? null
      : await wrapSession(
          {
            [PersistKey.IdToken]: "synthetic-provider-id-token",
            [PersistKey.AccessToken]: JSON.stringify({
              [`@${audience}`]: { token, scope: "", expiresAt: 4_102_444_800 },
            }),
          },
          cookieSecret,
        );
  return <T>(run: () => T): T => {
    const request = new NextRequest("https://inside.example.test", {
      headers: cookie === null ? {} : { cookie: `logto_${appId}=${cookie}` },
    });
    const store = createRequestStoreForAPI(
      request,
      new URL(request.url),
      {
        tags: [],
        expirationsByCacheKind: new Map(),
      },
      undefined,
      undefined,
      undefined,
    );
    const work = createWorkStore({
      page: "/api/module-test/route",
      buildId: "module-test",
      deploymentId: "module-test",
      previouslyRevalidatedTags: [],
      renderOpts: {
        cacheLifeProfiles: {
          default: { stale: 300, revalidate: 900, expire: 4_294_967_294 },
        },
        staticPageGenerationTimeout: 60,
        cacheComponents: false,
        validationLevel: "warning",
        experimental: {
          authInterrupts: false,
          useCacheTimeout: 50_000,
          durableUseCacheEntries: false,
        },
        isBuildTimePrerendering: false,
        waitUntil: undefined,
        onClose: () => {
          throw new Error("This module request does not support after() work");
        },
        onAfterTaskError: undefined,
      },
    });
    return workAsyncStorage.run(work, () =>
      workUnitAsyncStorage.run(store, run),
    );
  };
}
