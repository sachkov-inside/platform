import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

/** Модуль входа под общим кешем, даже если токен назван иначе. */
export async function readCatalogForReader(slug: string): Promise<string> {
  "use cache";
  applyCatalogCachePolicy("ready");
  return `${slug}:${String(await getOptionalPlatformAccessToken())}`;
}

declare function applyCatalogCachePolicy(kind: string): void;
