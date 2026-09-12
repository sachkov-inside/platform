import Link from "next/link";

import { legalSeller } from "@inside/legal/seller";

import { LEGAL_NAVIGATION } from "@/entities/legal-document";
import { LEGAL_PATH, legalDocumentPath } from "@/shared/routing/public-page-path";

/**
 * Нижняя часть публичных страниц: кто продаёт и где прочитать условия, обработку данных,
 * хранение в браузере, оплату и отмену. Ссылки ведут на текущие редакции; полный адрес,
 * телефон и порядок обращений живут в документе «Реквизиты и обращения», а не здесь.
 */
export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
      <nav aria-label="Документы Inside">
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL_NAVIGATION.map((entry) => (
            <li key={entry.key}>
              <Link
                className="underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href={legalDocumentPath(entry.key)}
              >
                {entry.navLabel}
              </Link>
            </li>
          ))}
          <li>
            <Link
              className="underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href={LEGAL_PATH}
            >
              Все документы
            </Link>
          </li>
        </ul>
      </nav>
      <p className="mt-5 text-xs leading-6">
        {legalSeller.name} · ИНН {legalSeller.inn} · ОГРНИП {legalSeller.ogrnip} ·{" "}
        <a
          className="underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={`mailto:${legalSeller.email}`}
        >
          {legalSeller.email}
        </a>
      </p>
    </footer>
  );
}
