import {
  BookOpenText,
  ListVideo,
  LockKeyhole,
  Play,
  Unlock,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { materialReaderHref } from "@/shared/routing/material-reader";
import { cn } from "@/shared/lib/utils";
import type { MaterialPreview } from "../model/material-preview";
import { materialTaxonomyLabel } from "../model/material-taxonomy-label";

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3";
  readonly material: MaterialPreview;
  readonly returnHref?: Route;
}

/** Safe published Material summary with media only when the presentation contract provides it. */
export function MaterialCard({
  headingLevel = "h2",
  material,
  returnHref,
}: MaterialCardProps) {
  const hasPreview = material.preview !== undefined;
  const Heading = headingLevel;
  const titleId = `material-${material.slug}-title`;

  return (
    <article
      className="@container/material-card h-full w-full max-w-[28rem]"
      data-material-id={material.slug}
      data-material-slug={material.slug}
    >
      <div
        className="group/card relative grid h-full overflow-hidden rounded-2xl bg-card no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-within:shadow-card-hover active:translate-y-0 active:shadow-card motion-reduce:transform-none motion-reduce:transition-none"
      >
        {hasPreview ? (
          <MaterialPoster material={material} preview={material.preview} />
        ) : null}
        <div
          className={cn(
            "flex h-full min-w-0 flex-col p-4",
            hasPreview && "min-h-[12.5rem]",
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <MaterialFormat material={material} />
            <AccessLabel
              access={material.access}
              availability={material.availability}
            />
          </div>
          <div className="mt-3">
            <MaterialTaxonomy material={material} />
          </div>
          <Heading className="mt-3 line-clamp-3 text-xl font-bold leading-[1.2] tracking-[-0.03em]">
            <Link
              className="no-underline after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring group-hover/card:underline group-hover/card:decoration-accent group-hover/card:underline-offset-4"
              href={materialReaderHref(material.slug, returnHref)}
              id={titleId}
              prefetch={false}
            >
              {material.title}
            </Link>
          </Heading>
          <p
            className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground"
          >
            {material.summary}
          </p>
          <MaterialPlaylists material={material} />
        </div>
      </div>
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
        <Link
          className="relative z-10 inline-flex min-h-7 items-center rounded-lg bg-accent/10 px-2.5 py-1 text-xs font-medium leading-4 text-foreground no-underline hover:bg-accent/20 focus-visible:outline-ring"
          href={`/topics/${material.topicSlug}`}
          prefetch={false}
        >
          {materialTaxonomyLabel(material.topic)}
        </Link>
      </li>
      {material.tags.slice(0, 2).map((tag) => (
        <li key={tag}>
          <span className="inline-flex min-h-7 items-center rounded-lg bg-secondary px-2.5 py-1 text-xs font-medium leading-4 text-muted-foreground">
            {tag}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MaterialFormat({
  material,
}: {
  readonly material: MaterialPreview;
}) {
  const FormatIcon = material.preview === undefined ? BookOpenText : Play;

  return (
    <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <FormatIcon aria-hidden="true" className="size-3.5 text-accent" />
      {materialTaxonomyLabel(material.format)}
    </span>
  );
}

function MaterialPlaylists({
  material,
}: {
  readonly material: MaterialPreview;
}) {
  if (material.seriesMemberships.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Плейлисты материала"
      className="mt-auto grid gap-1.5 pt-3 text-xs text-muted-foreground"
      role="list"
    >
      {material.seriesMemberships.map((membership) => (
        <li key={`${membership.name}-${String(membership.ordinal)}`}>
          <Link
            className="relative z-10 grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-1.5 py-2 no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
            href={`/series/${membership.slug}`}
            prefetch={false}
          >
            <ListVideo aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 break-words leading-4">{membership.name}</span>
            <span className="shrink-0 text-muted-foreground">№ {membership.ordinal}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AccessLabel({
  access,
  availability,
}: {
  readonly access: MaterialPreview["access"];
  readonly availability: MaterialPreview["availability"];
}) {
  const isAvailable = availability === "available";
  const Icon = isAvailable ? Unlock : LockKeyhole;
  const label =
    availability === "locked"
      ? "Для участников"
      : availability === "unavailable"
        ? "Недоступно"
        : access === "free"
          ? "Бесплатно"
          : "Доступно";

  return (
    <span
      className={cn(
        "inline-flex min-h-7 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        isAvailable
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
        className="absolute left-4 top-3 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-sidebar-foreground/55"
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
            className="relative grid min-h-12 min-w-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-1 text-center font-mono text-[0.6875rem] leading-4 text-sidebar-accent-foreground"
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
