import type { LegalEdition } from "@inside/legal";
import { legalSeller } from "@inside/legal/seller";
import Link from "next/link";

import {
  LEGAL_GROUP_ORDER,
  LEGAL_GROUP_TITLES,
  LEGAL_NAVIGATION,
  legalEffectiveNote,
  type LegalGroup,
} from "@/entities/legal-document";
import { legalDocumentPath } from "@/shared/routing/public-page-path";

/** Список юридического раздела: что действует, о чём документ и с какого дня он применяется. */
export function LegalSectionPage({
  editions,
}: {
  readonly editions: readonly LegalEdition[];
}) {
  return (
    <>
      <header className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Документы Inside
        </h1>
        <p className="mt-4 max-w-[66ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          Условия, оферты, обработка данных и реквизиты продавца. Каждый документ открыт без
          входа и без оплаты, а у каждой его редакции есть постоянный адрес и контрольная сумма.
        </p>
      </header>
      <div className="mt-10 flex max-w-3xl flex-col gap-10">
        {LEGAL_GROUP_ORDER.map((group) => (
          <LegalGroupSection editions={editions} group={group} key={group} />
        ))}
      </div>
      <section
        aria-labelledby="legal-seller-heading"
        className="mt-12 max-w-3xl border-t border-border pt-6"
      >
        <h2 className="text-lg font-semibold tracking-[-0.02em]" id="legal-seller-heading">
          Продавец
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {legalSeller.name}, ИНН {legalSeller.inn}, ОГРНИП {legalSeller.ogrnip}. Адрес для
          письменных обращений, телефон и порядок ответа — в документе{" "}
          <Link className="underline underline-offset-2" href={legalDocumentPath("contacts")}>
            «Реквизиты и обращения»
          </Link>
          . Письмо:{" "}
          <a className="underline underline-offset-2" href={`mailto:${legalSeller.email}`}>
            {legalSeller.email}
          </a>
          .
        </p>
      </section>
    </>
  );
}

function LegalGroupSection({
  editions,
  group,
}: {
  readonly editions: readonly LegalEdition[];
  readonly group: LegalGroup;
}) {
  const headingId = `legal-group-${group}`;
  const entries = LEGAL_NAVIGATION.filter((entry) => entry.group === group).flatMap(
    (entry) => {
      const edition = editions.find((candidate) => candidate.key === entry.key);
      return edition === undefined ? [] : [edition];
    },
  );
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 className="text-xl font-semibold tracking-[-0.025em]" id={headingId}>
        {LEGAL_GROUP_TITLES[group]}
      </h2>
      <ul className="mt-4 flex flex-col gap-3">
        {entries.map((edition) => (
          <li key={edition.key}>
            <Link
              className="flex flex-col gap-1 rounded-2xl border border-border p-4 no-underline transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
              href={legalDocumentPath(edition.key)}
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-foreground">{edition.title}</span>
                <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {legalEffectiveNote(edition.effectiveFrom)}
                </span>
              </span>
              <span className="text-sm leading-6 text-muted-foreground">{edition.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
