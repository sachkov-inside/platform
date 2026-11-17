import "next/dist/server/node-environment";

import { PersistKey, wrapSession } from "@logto/node";
import { NextRequest } from "next/server";
import { createRequestStoreForAPI } from "next/dist/server/async-storage/request-store";
import { createWorkStore } from "next/dist/server/async-storage/work-store";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { configureWebRuntime } from "./web-runtime";

const appId = "web-module-integration";
const cookieSecret = "web-module-integration-cookie-secret";
const audience = "https://platform-api.example.test";

/** Real encrypted provider session and Next request storage, without replacing Web auth modules. */
export async function realBffSession(
  token: string | null | { readonly refreshToken: string } = "trusted-token",
) {
  configureWebRuntime();
  const cookie =
    token === null
      ? null
      : await wrapSession(
          {
            [PersistKey.IdToken]: "synthetic-provider-id-token",
            ...(typeof token === "string"
              ? {
                  [PersistKey.AccessToken]: JSON.stringify({
                    [`@${audience}`]: {
                      token,
                      scope: "",
                      expiresAt: 4_102_444_800,
                    },
                  }),
                }
              : { [PersistKey.RefreshToken]: token.refreshToken }),
          },
          cookieSecret,
        );
  const scope = <T>(run: () => T): T => {
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
  return Object.assign(scope, {
    cookieHeader: cookie === null ? null : `logto_${appId}=${cookie}`,
  });
}
