import { ChevronRight, Clock3, LockKeyhole } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/shared/lib/utils";
import {
  collectionDiscoveryHref,
  materialReaderHref,
} from "@/shared/routing/material-reader";
import {
  materialPreviewHasVideo,
  type MaterialPreview,
} from "../model/material-preview";
import { materialTaxonomyLabel } from "../model/material-taxonomy-label";
import { ContentCoverImage } from "./content-cover-image.client";

import { SavedMaterialReadingStatus } from "./saved-material-reading-status.client";

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3";
  readonly material: MaterialPreview;
  readonly returnHref?: Route;
  /** Series-owned context rendered below the row title. */
  readonly rowAnnotation?: React.ReactNode;
  readonly readingStatus?: React.ReactNode;
  /** Existing video card with a short continuation caption supplied by its page. */
  readonly resumeLabel?: string;
  readonly variant?: "compact" | "default" | "feed" | "row";
}

/** Safe published Material summary rendered in the accepted public visual language. */
export function MaterialCard({
  headingLevel = "h2",
  material,
  returnHref,
  rowAnnotation,
  readingStatus = material.materialId === undefined ? undefined : <SavedMaterialReadingStatus materialId={material.materialId} format={material.format} />,
  resumeLabel,
  variant = "default",
}: MaterialCardProps) {
  const Heading = headingLevel;
  const readerHref = materialReaderHref(material.slug, returnHref);

  if (variant === "row") {
    return (
      <MaterialRow
        headingLevel={headingLevel}
        material={material}
        readerHref={readerHref}
        rowAnnotation={rowAnnotation}
        readingStatus={readingStatus}
        {...(returnHref === undefined ? {} : { returnHref })}
      />
    );
  }

  if (variant === "feed") {
    return (
      <article
        className="group/card relative grid w-full max-w-[48rem] grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 rounded-[1.5rem] border border-border bg-card p-5 md:p-6"
        data-material-id={material.slug}
        data-material-slug={material.slug}
        data-material-variant={variant}
      >
        <span
          aria-hidden="true"
          className="row-span-4 grid size-9 place-items-center rounded-full bg-primary text-xs font-bold text-white"
        >
          S
        </span>
        <p className="text-sm leading-5">
          <strong>Sachkov Inside</strong>
          <span className="text-muted-foreground"> · {material.topic}</span>
        </p>
        <Heading className="col-start-2 mt-2 text-lg font-semibold leading-6 tracking-[-0.03em] md:text-xl">
          <Link
            className="no-underline after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring group-hover/card:text-action"
            href={readerHref}
            prefetch={false}
          >
            {material.title}
          </Link>
        </Heading>
        <p className="col-start-2 mt-2 text-base leading-7 tracking-[-0.015em] text-body-muted md:text-lg">
          {material.summary}
        </p>
        {readingStatus ? <span className="col-start-2 mt-3">{readingStatus}</span> : null}
        <span className="col-start-2 mt-3 inline-flex items-center gap-1 text-sm font-semibold text-action">
          Читать заметку
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </article>
    );
  }

  const isCompact = variant === "compact";
  const duration = materialDuration(material);

  return (
    <article
      className="group/card relative h-full min-w-0 w-full"
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant={variant}
    >
      <AccessCover compact={isCompact} material={material}>
        <ContentCoverImage
          alt=""
          className={cn(
            "min-h-0 w-full transition-transform duration-200 group-hover/card:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none",
            isCompact
              ? "aspect-video rounded-[1.25rem]"
              : "aspect-square rounded-[1.5rem]",
          )}
          cover={material.cover ?? null}
          fallbackKind={isCompact ? "video" : "material"}
          fallbackSeed={material.slug}
          sizes="(min-width: 768px) 20rem, 50vw"
        />
        {isCompact && duration !== undefined ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/70 px-2.5 py-1 text-[0.6875rem] font-semibold text-white">
            {duration}
          </span>
        ) : null}
      </AccessCover>
      {isCompact ? null : (
        <span className="mt-3 block text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-eyebrow">
          {material.topic}
        </span>
      )}
      <Heading
        className={cn(
          "line-clamp-2 font-semibold tracking-[-0.025em]",
          isCompact
            ? "mt-3 text-[0.9375rem] leading-5 md:text-lg md:leading-6"
            : "mt-1 text-[0.9375rem] leading-5 tracking-[-0.02em] md:text-lg md:leading-6",
        )}
      >
        <Link
          className="no-underline after:absolute after:inset-0 after:rounded-[1.5rem] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          href={readerHref}
          prefetch={false}
        >
          {material.title}
        </Link>
      </Heading>
      {readingStatus ? <span className="mt-2 block">{readingStatus}</span> : null}
      {isCompact ? (
        <span className={cn("mt-1 block text-xs font-medium md:text-sm", resumeLabel === undefined ? "text-muted-foreground" : "text-action")}>
          {resumeLabel ?? material.topic}
        </span>
      ) : duration === undefined ? null : (
        <span className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Clock3 aria-hidden="true" className="size-3.5" />
          {duration}
        </span>
      )}
    </article>
  );
}

function MaterialRow({
  headingLevel,
  material,
  readerHref,
  returnHref,
  rowAnnotation,
  readingStatus,
}: {
  readonly headingLevel: "h2" | "h3";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
  readonly returnHref?: Route;
  readonly rowAnnotation?: React.ReactNode;
  readonly readingStatus?: React.ReactNode;
}) {
  const Heading = headingLevel;
  const isVideo = materialPreviewHasVideo(material);
  return (
    <article
      className="group/row relative grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-3 rounded-2xl border border-black/8 bg-muted/55 p-3 shadow-card transition-[box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-card-hover motion-reduce:transform-none motion-reduce:transition-none"
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant="row"
    >
      <AccessCover compact material={material}>
        <ContentCoverImage
          alt=""
          className="aspect-square min-h-0 rounded-xl"
          cover={material.cover ?? null}
          fallbackKind={isVideo ? "video" : "material"}
          fallbackSeed={material.slug}
          sizes="(min-width: 640px) 5.5rem, 3.5rem"
        />
      </AccessCover>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
          <span>{materialTaxonomyLabel(material.format)}</span>
          <span aria-hidden="true">·</span>
          <Link
            className="relative z-10 truncate no-underline hover:text-foreground"
            href={collectionDiscoveryHref("topic", material.topicSlug, returnHref)}
            prefetch={false}
          >
            {material.topic}
          </Link>
        </span>
        <Heading className="mt-1 line-clamp-3 text-sm font-semibold leading-5 tracking-[-0.02em] sm:line-clamp-2 sm:text-base">
          <Link
            className="no-underline after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            href={readerHref}
            prefetch={false}
          >
            {material.title}
          </Link>
        </Heading>
        {isVideo && material.summary.length > 0 ? (
          <span className="mt-2 line-clamp-3 break-words text-sm leading-5 text-body-muted">
            {material.summary}
          </span>
        ) : null}
        {readingStatus ? <span className="mt-2 block">{readingStatus}</span> : null}
        {rowAnnotation}
      </span>
      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
    </article>
  );
}

function AccessCover({
  children,
  compact = false,
  material,
}: {
  readonly children: React.ReactNode;
  readonly compact?: boolean;
  readonly material: MaterialPreview;
}) {
  const locked = material.availability !== "available";
  if (!locked) return <span className="relative block">{children}</span>;

  return (
    <span
      className={cn(
        "relative block overflow-hidden",
        compact ? "rounded-xl" : "rounded-[1.5rem]",
      )}
      data-access-cover={material.availability}
    >
      <span className="block scale-[1.04] blur-[4px]">{children}</span>
      <span className="absolute inset-0 grid place-items-center bg-white/20">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-white/92 font-semibold text-foreground shadow-xl backdrop-blur-xl",
            compact ? "size-8 justify-center p-0" : "px-3 py-2 text-xs",
          )}
        >
          <LockKeyhole aria-hidden="true" className="size-4 text-accent" />
          {compact ? (
            <span className="sr-only">{materialAccessLabel(material)}</span>
          ) : (
            materialAccessLabel(material)
          )}
        </span>
      </span>
    </span>
  );
}

function materialDuration(material: MaterialPreview): string | undefined {
  return material.primaryVideoDurationSeconds === undefined
    ? material.preview?.duration
    : formatDuration(material.primaryVideoDurationSeconds);
}

function materialAccessLabel(material: MaterialPreview): string {
  if (material.availability === "locked") return "Для участников";
  if (material.availability === "unavailable") return "Недоступно";
  return material.access === "free" ? "Бесплатно" : "Доступно";
}

function formatDuration(totalSeconds: number): string {
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
