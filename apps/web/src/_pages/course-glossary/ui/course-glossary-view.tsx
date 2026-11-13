import { glossaryDefinitionParagraphs } from "@/entities/material.model";
import { materialReaderHref } from "@/shared/routing/material-reader";
import {
  courseGlossaryTermAnchor,
  productProgrammeHref,
} from "@/shared/routing/subscription-route";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import type { CourseGlossary } from "../model/course-glossary";

const frame = "mx-auto min-h-svh w-full min-w-0 max-w-[43rem]";

/**
 * «Словарь курса»: термины, которые вводят уроки курса, по алфавиту, каждый со ссылкой на урок, где
 * он введён. «Подробнее» в подсказке термина ведёт сюда, к карточке этого термина.
 */
export function CourseGlossaryView({
  glossary,
}: {
  readonly glossary: CourseGlossary;
}) {
  const programme = productProgrammeHref(glossary.product.slug);
  return (
    <div className={frame} data-course-glossary={glossary.product.slug}>
      <CatalogBackLink href={programme} label="К программе" />
      <header className="mt-2">
        <p className="text-sm text-muted-foreground">{glossary.product.name}</p>
        <h1 className="mt-1 text-[1.375rem] font-semibold leading-[1.2] tracking-[-0.025em] sm:text-2xl md:text-[1.75rem]">
          Словарь курса
        </h1>
      </header>
      {glossary.terms.length === 0 ? (
        <p className="mt-6 text-muted-foreground" role="status">
          Терминов пока нет: они появятся здесь, когда откроются уроки, которые
          их вводят.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {glossary.terms.map((term) => (
            <li
              className="scroll-mt-24 rounded-2xl border border-border bg-card p-4 target:border-ring target:ring-2 target:ring-ring/40 sm:p-5"
              data-course-glossary-term={term.id}
              id={courseGlossaryTermAnchor(term.id)}
              key={term.id}
            >
              <h2 className="text-lg font-semibold">
                {term.title}
                {term.englishTitle === null ? null : (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ({term.englishTitle})
                  </span>
                )}
              </h2>
              <div className="mt-2 leading-7">
                {glossaryDefinitionParagraphs(term.fullDefinition).map(
                  (paragraph, index) => (
                    <p className="mt-2 first:mt-0" key={index}>
                      {paragraph}
                    </p>
                  ),
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Введён в уроке{" "}
                <IntentPrefetchLink
                  className="text-foreground underline underline-offset-4"
                  href={materialReaderHref(term.lesson.slug, programme)}
                >
                  {term.lesson.title}
                </IntentPrefetchLink>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Скелет словаря: та же колонка, ряд возврата, шапка и карточки терминов. */
export function CourseGlossaryLoading() {
  const pulse = "animate-pulse motion-reduce:animate-none";
  return (
    <div
      aria-busy="true"
      aria-label="Словарь курса загружается"
      role="status"
      className={frame}
      data-route-skeleton="course-glossary"
    >
      <div className={`h-11 w-32 rounded-lg bg-muted ${pulse}`} />
      <div className={`mt-2 h-5 w-40 rounded-md bg-muted/80 ${pulse}`} />
      {/* Высота строки заголовка: `1.2em` от того же размера шрифта, что у `h1` словаря. */}
      <div
        className={`mt-1 h-[1.2em] w-56 rounded-lg bg-muted text-[1.375rem] sm:text-2xl md:text-[1.75rem] ${pulse}`}
      />
      <div className="mt-6 grid gap-4">
        {[0, 1, 2, 3].map((row) => (
          <div className={`h-36 rounded-2xl bg-muted/65 ${pulse}`} key={row} />
        ))}
      </div>
    </div>
  );
}
