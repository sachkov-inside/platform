import type { LegalBlock, LegalEdition } from "@inside/legal";
import Link from "next/link";

import { legalEffectiveDate } from "@/entities/legal-document";
import {
  LEGAL_PATH,
  legalDocumentPath,
  legalEditionPath,
} from "@/shared/routing/public-page-path";

import { LegalDocumentView } from "./legal-document-view";

/**
 * Страница документа. По своему адресу показывает действующую редакцию; по адресу редакции —
 * именно её, с явной отметкой и ссылкой на действующий текст.
 */
export function LegalDocumentPage({
  blocks,
  current,
  edition,
  superseded,
}: {
  readonly blocks: readonly LegalBlock[];
  readonly current: LegalEdition;
  readonly edition: LegalEdition;
  readonly superseded: readonly LegalEdition[];
}) {
  const pinned = edition.version !== current.version;
  return (
    <article className="max-w-3xl">
      <nav aria-label="Раздел" className="text-sm">
        <Link className="text-muted-foreground underline underline-offset-2" href={LEGAL_PATH}>
          Документы Inside
        </Link>
      </nav>
      <div className="mt-4">
        {pinned ? (
          <p className="mb-6 rounded-2xl border border-border bg-muted px-4 py-3 text-sm leading-6">
            Это редакция {edition.version}. Действует{" "}
            <Link
              className="underline underline-offset-2"
              href={legalDocumentPath(edition.key)}
            >
              редакция {current.version}
            </Link>
            .
          </p>
        ) : null}
        <LegalDocumentView blocks={blocks} />
      </div>
      <footer className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
        <h2 className="font-semibold text-foreground">Эта редакция</h2>
        <dl className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium">Номер:</dt>
            <dd>
              {edition.version} · действует с {legalEffectiveDate(edition.effectiveFrom)}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium">Постоянный адрес:</dt>
            <dd>
              <Link
                className="underline underline-offset-2"
                href={legalEditionPath(edition.key, edition.version)}
              >
                {legalEditionPath(edition.key, edition.version)}
              </Link>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium">SHA-256 текста:</dt>
            <dd className="font-mono text-xs break-all">{edition.digest}</dd>
          </div>
        </dl>
        {superseded.length > 0 ? (
          <>
            <h2 className="mt-6 font-semibold text-foreground">Прежние редакции</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {superseded.map((item) => (
                <li key={item.version}>
                  <Link
                    className="underline underline-offset-2"
                    href={legalEditionPath(item.key, item.version)}
                  >
                    Редакция {item.version} · действует с {legalEffectiveDate(item.effectiveFrom)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </footer>
    </article>
  );
}
