import Link from "next/link";

import { legalSeller } from "@inside/legal/seller";

import { LEGAL_NAVIGATION } from "@/entities/legal-document";
import {
  LEGAL_PATH,
  legalDocumentPath,
} from "@/shared/routing/public-page-path";

/**
 * Нижняя часть публичных страниц: кто продаёт и где прочитать документы. Подвал короткий
 * (решение владельца 09.10.2026): данные, хранение в браузере, реквизиты и ссылка на все
 * документы; условия и оферты — в разделе документов и в самом оформлении покупки. Полный
 * адрес, телефон и порядок обращений живут в документе «Реквизиты и обращения».
 */
const FOOTER_DOCUMENTS = new Set(["privacy", "cookies", "contacts"]);

export function PublicFooter() {
  return (
    <footer className="border-t border-border pt-5 text-xs text-muted-foreground sm:text-sm">
      <nav aria-label="Документы Inside">
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {LEGAL_NAVIGATION.filter((entry) =>
            FOOTER_DOCUMENTS.has(entry.key),
          ).map((entry) => (
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
      <p className="mt-3 text-xs leading-5">
        {legalSeller.name} · ИНН {legalSeller.inn} · ОГРНИП {legalSeller.ogrnip}{" "}
        ·{" "}
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
