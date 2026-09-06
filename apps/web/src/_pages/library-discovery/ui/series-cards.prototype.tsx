"use client";

// #301: compare relationships between explicit guide steps, keeping the same MaterialCard.
// A: connecting rail. B: links between guide annotations. C: compact sequence overview.
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { PrototypeSwitcher } from "@/shared/ui/prototype-switcher";
import { seriesSteps, type SeriesStep } from "../model/series-steps";

const anchor = (slug: string) => `series-entry-${slug}`;
const shortTitle = (material: MaterialPreview) => material.title.replace(/^Demo\s*·\s*/, "");

function StepMark({ step }: { readonly step: SeriesStep }) {
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
    <span className="font-semibold text-action">Шаг {step.ordinal} из {step.total}</span>
    <span className="min-w-0 break-words text-muted-foreground">{step.label}</span>
  </span>;
}

function GuideLinks({ previous, next, step }: { readonly previous: MaterialPreview | undefined; readonly next: MaterialPreview | undefined; readonly step: SeriesStep }) {
  return <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5">
    {previous ? <a className="relative z-10 text-muted-foreground underline decoration-black/15 underline-offset-4 hover:text-action" href={`#${anchor(previous.slug)}`} title={shortTitle(previous)}>↑ Шаг {step.ordinal - 1}</a> : null}
    {next ? <a className="relative z-10 text-action underline decoration-current/25 underline-offset-4 hover:text-foreground" href={`#${anchor(next.slug)}`} title={shortTitle(next)}>Шаг {step.ordinal + 1} ↓</a> : <span className="text-muted-foreground">Последний шаг</span>}
  </span>;
}

function SequenceOverview({ items, steps }: { readonly items: readonly MaterialPreview[]; readonly steps: ReadonlyMap<string, SeriesStep> }) {
  const labels = [...new Set([...steps.values()].map(({ label }) => label))];
  return <div className="mb-6 ml-11 mt-4 space-y-5" data-guide-overview>
    {labels.map(label => <nav key={label} aria-label={`Текстовая инструкция: ${label}`} className="rounded-2xl border border-action/15 bg-action/5 p-4">
      <p className="text-xs font-medium text-muted-foreground">Текстовая инструкция</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
      <ol className="mt-4 flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
        {items.filter(item => steps.get(item.slug)?.label === label).map((item, index, guides) => {
          const next = guides[index + 1];
          const between = next ? items.slice(items.indexOf(item) + 1, items.indexOf(next)) : [];
          return <li key={item.slug} className="min-w-0 flex-1">
            <a className="flex items-start gap-2 text-sm font-medium no-underline hover:text-action" href={`#${anchor(item.slug)}`}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-action text-xs text-white">{index + 1}</span>
              <span>{shortTitle(item)}{next ? <span aria-hidden="true" className="ml-2 text-action">→</span> : null}</span>
            </a>
            {between.length ? <p className="ml-8 mt-2 text-xs leading-5 text-muted-foreground">Между шагами: {between.map((entry, entryIndex) => <span key={entry.slug}>{entryIndex ? " · " : ""}<a className="underline decoration-black/15 underline-offset-2 hover:text-action" href={`#${anchor(entry.slug)}`}>{entry.format.toLowerCase()}</a></span>)}</p> : null}
          </li>;
        })}
      </ol>
    </nav>)}
  </div>;
}

export function SeriesCardsPrototype({ items, seriesSlug, returnHref }: { readonly items: readonly MaterialPreview[]; readonly seriesSlug: string; readonly returnHref: Route }) {
  const query = useSearchParams();
  const requested = query.get("variant");
  const variant = requested === "B" || requested === "C" ? requested : "A";
  const steps = seriesSteps(items, seriesSlug);
  return <div className="pb-36" data-card-prototype={variant}>
    {variant === "C" ? <SequenceOverview items={items} steps={steps} /> : null}
    <ol className="mt-4 grid gap-4" data-series-order aria-label="Материалы серии">{items.map((material, index) => {
      const step = steps.get(material.slug);
      const ordinal = material.seriesMemberships.find(({ slug }) => slug === seriesSlug)?.ordinal ?? index + 1;
      const related = step ? items.filter(item => steps.get(item.slug)?.label === step.label) : [];
      const guideIndex = related.indexOf(material);
      return <li className="relative grid scroll-mt-24 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3" data-series-ordinal={ordinal} id={anchor(material.slug)} key={material.slug}>
        {variant === "A" && items.length > 1 ? <span aria-hidden="true" data-guide-rail className="pointer-events-none absolute left-[15px] w-0 border-l-2 border-dashed border-action/35" style={{ top: index === 0 ? "50%" : "-1rem", bottom: index === items.length - 1 ? "50%" : "-1rem" }} /> : null}
        <div className="relative z-10 flex min-h-11 items-center font-semibold text-muted-foreground">
          <span data-sequence-marker={step ? "guide-step" : "material"} className={`grid size-8 place-items-center rounded-full text-xs font-bold ${variant === "A"
            ? step ? "bg-action text-white ring-4 ring-white" : "border border-black/20 bg-white text-muted-foreground ring-4 ring-white"
            : "bg-primary text-white"}`}>{ordinal}</span>
        </div>
        <div className="min-w-0">
          <MaterialCard headingLevel="h3" material={material} returnHref={returnHref} variant="row"
            rowAnnotation={step ? <span data-series-step className="mt-2 block">
              <StepMark step={step} />
              {variant === "B" ? <GuideLinks step={step} previous={related[guideIndex - 1]} next={related[guideIndex + 1]} /> : null}
            </span> : undefined} />
        </div>
      </li>;
    })}</ol>
    <PrototypeSwitcher />
  </div>;
}
