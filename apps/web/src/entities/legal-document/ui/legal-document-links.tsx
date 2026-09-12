import type { LegalDocumentKey } from "@inside/legal/document";
import Link from "next/link";

import { legalDocumentPath } from "@/shared/routing/public-page-path";

import { legalNavigationEntry } from "../model/catalog";

/**
 * Ссылки на действующие документы рядом с формой: человек читает условия и правила обработки
 * до действия, а не после него. Это только ссылки: согласие остаётся отдельным действием в своей
 * форме и здесь не подразумевается.
 */
export function LegalDocumentLinks({
  className,
  label,
  keys,
}: {
  readonly className?: string;
  readonly label: string;
  readonly keys: readonly LegalDocumentKey[];
}) {
  const entries = keys
    .map((key) => legalNavigationEntry(key))
    .filter((entry) => entry !== null);
  if (entries.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              className="text-action underline underline-offset-4"
              href={legalDocumentPath(entry.key)}
            >
              {entry.navLabel}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
