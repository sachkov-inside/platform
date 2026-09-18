import { cookies } from "next/headers";

/** Cookie под общим кешем: ответ одного браузера достался бы всем. */
export async function readCatalogForBrowser(slug: string): Promise<string> {
  "use cache";
  applyCatalogCachePolicy("ready");
  return `${slug}:${String((await cookies()).size)}`;
}

declare function applyCatalogCachePolicy(kind: string): void;
