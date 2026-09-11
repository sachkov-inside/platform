import type { GuideIntroduction } from "@/features/library-discovery";

/**
 * The author's own answer to the four questions a reader asks before starting:
 * what they will be able to do, who the Guide is written for, what they need
 * beforehand and what it deliberately leaves out. An unfilled field is absent
 * rather than shown empty, so a partly written Guide never looks complete.
 */
export function GuideIntroductionSection({
  introduction,
}: {
  readonly introduction: GuideIntroduction;
}) {
  const entries = [
    { label: "Что вы сможете", value: introduction.outcome },
    { label: "Для кого", value: introduction.audience },
    { label: "Что нужно знать заранее", value: introduction.prerequisites },
    { label: "Что разбираем и что остаётся за границами", value: introduction.scope },
  ].filter(({ value }) => value.trim().length > 0);
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="guide-introduction" className="mt-8">
      <h2 className="sr-only" id="guide-introduction">
        О руководстве
      </h2>
      <dl className="grid gap-6 sm:grid-cols-2">
        {entries.map(({ label, value }) => (
          <div className="min-w-0" key={label}>
            <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-2 whitespace-pre-line break-words text-sm leading-6">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
