import { legalEditions } from "@inside/legal";
import {
  legalDocumentKeys,
  legalDocumentPath,
  legalEditionPath,
} from "@inside/legal/document";

/** Адреса всех редакций: по ним собираются страницы во время сборки. */
export function legalEditionParams(): {
  readonly slug: string;
  readonly version: string;
}[] {
  return legalEditions.map((edition) => ({
    slug: edition.key,
    version: `v${String(edition.version)}`,
  }));
}

/** Документ и каждая его редакция: адреса, которые раздел собирает и на которые отвечает. */
const legalPagePaths: ReadonlySet<string> = new Set([
  ...legalDocumentKeys.map((key) => legalDocumentPath(key)),
  ...legalEditions.map((edition) => legalEditionPath(edition.key, edition.version)),
]);

/** Опубликован ли адрес страницы раздела; `proxy` спрашивает это до начала ответа (ADR 0027). */
export function isLegalPagePath(pathname: string): boolean {
  return legalPagePaths.has(pathname);
}
