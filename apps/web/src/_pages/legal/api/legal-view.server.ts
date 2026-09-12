import "server-only";

import {
  currentLegalEdition,
  currentLegalEditions,
  findLegalEdition,
  parseLegalText,
  supersededLegalEditions,
  type LegalBlock,
  type LegalEdition,
} from "@inside/legal";
import { legalDocumentKeys, legalEditionVersion } from "@inside/legal/document";

/**
 * Что страница показывает про документ: разобранный текст запрошенной редакции, действующая
 * редакция и прежние. Маршрут только отвечает адресом, а состав страницы собирается здесь.
 */
export interface LegalDocumentView {
  readonly blocks: readonly LegalBlock[];
  readonly current: LegalEdition;
  readonly edition: LegalEdition;
  readonly superseded: readonly LegalEdition[];
}

function documentKey(slug: string) {
  return legalDocumentKeys.find((key) => key === slug) ?? null;
}

/** Действующие редакции в порядке раздела. */
export function legalSectionView(): readonly LegalEdition[] {
  return currentLegalEditions();
}

/**
 * Документ по адресу раздела. `version` задан, когда открыт адрес названной редакции;
 * неизвестный документ или редакция дают `null`, и маршрут отвечает 404.
 */
export function legalDocumentView(
  slug: string,
  version?: string,
): LegalDocumentView | null {
  const key = documentKey(slug);
  if (key === null) return null;
  const current = currentLegalEdition(key);
  let edition = current;
  if (version !== undefined) {
    const requested = legalEditionVersion(version);
    const found = requested === undefined ? undefined : findLegalEdition(key, requested);
    if (found === undefined) return null;
    edition = found;
  }
  return {
    blocks: parseLegalText(edition.text),
    current,
    edition,
    superseded: supersededLegalEditions(key),
  };
}

/** Адреса всех редакций: по ним собираются страницы во время сборки. */
export function legalEditionParams(): {
  readonly slug: string;
  readonly version: string;
}[] {
  return legalEditions().map((edition) => ({
    slug: edition.key,
    version: `v${String(edition.version)}`,
  }));
}

function legalEditions(): readonly LegalEdition[] {
  return legalDocumentKeys.flatMap((key) => [
    currentLegalEdition(key),
    ...supersededLegalEditions(key),
  ]);
}
