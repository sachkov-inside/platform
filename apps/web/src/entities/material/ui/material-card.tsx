import {
  BookOpenText,
  ListVideo,
  LockKeyhole,
  Play,
  Unlock,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/shared/lib/utils";
import type { MaterialPreview } from "../model/material-preview";

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3";
  readonly material: MaterialPreview;
}

/** Safe published Material summary with media only when the presentation contract provides it. */
export function MaterialCard({
  headingLevel = "h2",
  material,
}: MaterialCardProps) {
  const hasPreview = material.preview !== undefined;
  const Heading = headingLevel;
  const titleId = `material-${material.slug}-title`;

  return (
    <article
      className={cn(
        "@container/material-card w-full max-w-[28rem]",
        hasPreview ? "h-full" : "self-start",
      )}
      data-material-id={material.slug}
      data-material-slug={material.slug}
    >
      <Link
        aria-labelledby={titleId}
        className={cn(
          "group/card grid overflow-hidden rounded-xl bg-card no-underline shadow-card transition-[box-shadow,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
          "hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-ring active:translate-y-0 active:shadow-card",
          hasPreview && "h-full",
        )}
        href={`/materials/${material.slug}`}
        prefetch={false}
      >
        {hasPreview ? (
          <MaterialPoster material={material} preview={material.preview} />
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-col p-4",
            hasPreview && "min-h-[12.5rem]",
          )}
        >
          <MaterialTaxonomy material={material} />
          <Heading
            className="mt-3 line-clamp-2 text-base font-semibold leading-[1.3] tracking-[-0.02em]"
            id={titleId}
          >
            <span className="group-hover/card:underline group-hover/card:decoration-accent group-hover/card:underline-offset-4">
              {material.title}
            </span>
          </Heading>
          <p
            className={cn(
              "mt-2 text-sm leading-5 text-muted-foreground",
              hasPreview ? "line-clamp-1" : "line-clamp-2",
            )}
          >
            {material.summary}
          </p>
          <div
            className={cn(
              "flex flex-wrap items-end justify-between gap-2",
              hasPreview ? "mt-auto pt-3" : "mt-3",
            )}
          >
            <MaterialContext material={material} />
            <AccessLabel access={material.access} />
          </div>
        </div>
      </Link>
    </article>
  );
}

function MaterialTaxonomy({
  material,
}: {
  readonly material: MaterialPreview;
}) {
  return (
    <ul aria-label="Контекст материала" className="flex flex-wrap gap-1.5" role="list">
      <li>
        <span className="inline-flex min-h-7 items-center rounded-md bg-accent/10 px-2 py-1 text-[0.6875rem] font-semibold leading-4 text-foreground">
          {material.topic}
        </span>
      </li>
      {material.tags.slice(0, 2).map((tag) => (
        <li key={tag}>
          <span className="inline-flex min-h-7 items-center rounded-md bg-secondary px-2 py-1 text-[0.6875rem] font-semibold leading-4 text-secondary-foreground/75">
            {tag}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MaterialContext({
  material,
}: {
  readonly material: MaterialPreview;
}) {
  const FormatIcon = material.preview === undefined ? BookOpenText : Play;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <FormatIcon aria-hidden="true" className="size-3.5 text-accent" />
        {material.format}
      </span>
      {material.seriesMemberships.map((membership) => (
        <span
          className="inline-flex min-w-0 flex-1 items-center gap-1.5"
          key={`${membership.name}-${String(membership.ordinal)}`}
        >
          <ListVideo aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            {membership.name} · выпуск {membership.ordinal}
          </span>
        </span>
      ))}
    </span>
  );
}

function AccessLabel({
  access,
}: {
  readonly access: MaterialPreview["access"];
}) {
  const Icon = access === "free" ? Unlock : LockKeyhole;
  const label = access === "free" ? "Бесплатно" : "Для участников";

  return (
    <span
      className={cn(
        "inline-flex min-h-7 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        access === "free"
          ? "bg-secondary text-secondary-foreground"
          : "bg-primary text-primary-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

function MaterialPoster({
  material,
  preview,
}: {
  readonly material: MaterialPreview;
  readonly preview: NonNullable<MaterialPreview["preview"]>;
}) {
  return (
    <span
      aria-label={preview.label}
      className="relative grid aspect-video min-h-0 place-items-center overflow-clip bg-sidebar p-4 text-sidebar-foreground"
      role="img"
    >
      <span
        aria-hidden="true"
        className="absolute left-4 top-3 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-sidebar-foreground/55"
      >
        {material.format}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative grid w-full items-center gap-1.5 pt-7 before:absolute before:inset-x-4 before:top-[calc(50%+0.875rem)] before:h-px before:bg-sidebar-primary",
          preview.steps.length > 3 ? "grid-cols-5" : "grid-cols-3",
        )}
      >
        {preview.steps.map((step) => (
          <span
            className="relative grid min-h-12 min-w-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-1 text-center font-mono text-[0.5625rem] leading-4 text-sidebar-accent-foreground sm:text-[0.625rem]"
            key={step}
          >
            {step}
          </span>
        ))}
      </span>
      {preview.duration === undefined ? null : (
        <span className="absolute bottom-3 right-3 rounded-md bg-sidebar-foreground px-2 py-1 font-mono text-[0.6875rem] font-semibold tabular-nums text-sidebar">
          {preview.duration}
        </span>
      )}
    </span>
  );
}
