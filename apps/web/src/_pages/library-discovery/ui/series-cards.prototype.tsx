"use client";

// #301: same production MaterialCard in every variant; only the step mark differs.
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { PrototypeSwitcher } from "@/shared/ui/prototype-switcher";
import { seriesSteps, type SeriesStep } from "../model/series-steps";

function StepMark({ step, variant }: { readonly step: SeriesStep; readonly variant: string }) {
  const number = `Шаг ${step.ordinal} из ${step.total}`;
  return (
    <span data-series-step className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
      <span className={variant === "B"
        ? "rounded-full bg-secondary px-2 font-semibold text-foreground"
        : variant === "C"
          ? "border-l-2 border-action pl-2 font-semibold text-action"
          : "font-semibold text-muted-foreground"}>{number}</span>
      <span className="min-w-0 break-words text-muted-foreground">{step.label}</span>
    </span>
  );
}

export function SeriesCardsPrototype({ items, seriesSlug, returnHref }: { readonly items: readonly MaterialPreview[]; readonly seriesSlug: string; readonly returnHref: Route }) {
  const query = useSearchParams();
  const requested = query.get("variant");
  const variant = requested === "B" || requested === "C" ? requested : "A";
  const steps = seriesSteps(items, seriesSlug);
  return <div className="pb-36" data-card-prototype={variant}>
    <ol className="mt-4 grid gap-4" data-series-order aria-label="Материалы серии">{items.map((material, index) => {
      const step = steps.get(material.slug);
      const ordinal = material.seriesMemberships.find(({ slug }) => slug === seriesSlug)?.ordinal ?? index + 1;
      return <li className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3" data-series-ordinal={ordinal} key={material.slug}>
        <div className="flex min-h-11 items-center font-semibold text-muted-foreground">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">{ordinal}</span>
        </div>
        <div className="min-w-0">
          <MaterialCard headingLevel="h3" material={material} returnHref={returnHref} variant="row"
            rowAnnotation={step ? <StepMark step={step} variant={variant} /> : undefined} />
        </div>
      </li>;
    })}</ol>
    <PrototypeSwitcher />
  </div>;
}
