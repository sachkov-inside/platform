"use client";

// #301: three structural variants on the existing Series route via ?variant=A|B|C.
// Read-only throwaway presentation. Keep the winner only after owner review.
import { ChevronRight, FileText, Play, StickyNote } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { ContentCoverImage, materialTaxonomyLabel, type MaterialPreview } from "@/entities/material";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { PrototypeSwitcher } from "@/shared/ui/prototype-switcher";
import { seriesSteps, type SeriesStep } from "../model/series-steps";

interface CardProps {
  readonly material: MaterialPreview;
  readonly step?: SeriesStep;
  readonly position: number;
  readonly returnHref: Route;
}

function FormatIcon({ material, className = "size-5" }: { material: MaterialPreview; className?: string }) {
  const Icon = material.format === "Видео" ? Play : material.format === "Заметка" ? StickyNote : FileText;
  return <Icon aria-hidden="true" className={className} />;
}

function Title({ material, returnHref }: CardProps) {
  return <h3 className="text-base font-semibold leading-snug tracking-[-0.02em] sm:text-lg"><Link className="no-underline after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring group-hover:text-action" href={materialReaderHref(material.slug, returnHref)} prefetch={false}>{material.title}</Link></h3>;
}

export function VariantA(props: CardProps) {
  const { material, position, step } = props;
  return <article className="group relative grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-4 rounded-3xl border border-border bg-card p-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_1rem] sm:p-5">
    <ContentCoverImage alt="" cover={material.cover ?? null} fallbackSeed={material.slug} fallbackKind={material.format === "Видео" ? "video" : "material"} className="aspect-square w-full rounded-2xl" sizes="72px" />
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{String(position).padStart(2, "0")} · {materialTaxonomyLabel(material.format)}</p>
      <Title {...props} />
      {step ? <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5" data-series-step><span className="rounded-md bg-secondary px-2 font-semibold">Шаг {step.ordinal} из {step.total}</span><span className="min-w-0 break-words text-muted-foreground">{step.label}</span></div> : null}
    </div>
    <ChevronRight aria-hidden="true" className="hidden size-4 text-muted-foreground sm:block" />
  </article>;
}

export function VariantB(props: CardProps) {
  const { material, position, step } = props;
  return <article className="group relative flex overflow-hidden rounded-3xl border border-border bg-card">
    <div className={`flex w-16 shrink-0 flex-col items-center justify-center gap-1 sm:w-24 ${step ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>
      {step ? <><span className="text-[10px] font-semibold uppercase tracking-wider">Шаг</span><span className="text-3xl font-semibold tracking-tight sm:text-4xl">{String(step.ordinal).padStart(2, "0")}</span><span className="text-xs text-muted-foreground">из {step.total}</span></> : <FormatIcon material={material} className="size-6" />}
    </div>
    <div className="min-w-0 flex-1 p-4 sm:px-6 sm:py-5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{materialTaxonomyLabel(material.format)} · Материал {position}</p>
      <Title {...props} />
      {step ? <p data-series-step className="mt-3 break-words text-sm font-medium">{step.label}</p> : <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{material.summary}</p>}
    </div>
    <ChevronRight aria-hidden="true" className="my-auto mr-4 hidden size-4 shrink-0 text-muted-foreground sm:block" />
  </article>;
}

export function VariantC(props: CardProps) {
  const { material, position, step } = props;
  return <article className={`group relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 rounded-2xl px-4 py-5 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5 border border-border bg-card`}>
    <span className="pt-0.5 text-xs font-medium text-muted-foreground">{String(position).padStart(2, "0")}</span>
    <div className="min-w-0"><Title {...props} /><p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><FormatIcon material={material} className="size-3.5" />{materialTaxonomyLabel(material.format)}</p></div>
    {step ? <div data-series-step className="col-start-2 mt-3 min-w-0 sm:col-start-3 sm:mt-0 sm:max-w-52 sm:text-right"><p className="text-sm font-semibold">Шаг {step.ordinal} / {step.total}</p><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{step.label}</p></div> : null}
  </article>;
}

export function SeriesCardsPrototype({ items, seriesSlug, returnHref }: { readonly items: readonly MaterialPreview[]; readonly seriesSlug: string; readonly returnHref: Route }) {
  const query = useSearchParams();
  const variant = query.get("variant") ?? "A";
  const Card = variant === "B" ? VariantB : variant === "C" ? VariantC : VariantA;
  const steps = seriesSteps(items, seriesSlug);
  return <div className="pb-36" data-card-prototype={variant}>
    <ol className={`mt-5 grid ${variant === "C" ? "gap-2" : "gap-3"}`} aria-label="Материалы серии">{items.map((material, index) => {
      const step = steps.get(material.slug);
      return <li key={material.slug}><Card material={material} position={index + 1} returnHref={returnHref} {...(step ? { step } : {})} /></li>;
    })}</ol>
    <PrototypeSwitcher />
  </div>;
}
