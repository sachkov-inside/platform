import { ChevronRight, Clock3, Link2, LockKeyhole, Play } from "lucide-react";
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
import { feedLink } from "../model/feed-link";

import { SavedMaterialReadingStatus } from "./saved-material-reading-status.client";

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly returnHref?: Route;
  /** Series-owned context rendered below the row title. */
  readonly rowAnnotation?: React.ReactNode;
  readonly seriesOrdinal?: number;
  readonly readingStatus?: React.ReactNode;
  /** Existing video card with a short continuation caption supplied by its page. */
  readonly resumeLabel?: string;
  readonly showAccessDetails?: boolean;
  readonly variant?: "compact" | "default" | "feed" | "row" | "series";
}

/** Safe published Material summary rendered in the accepted public visual language. */
export function MaterialCard({
  headingLevel = "h2",
  material,
  returnHref,
  rowAnnotation,
  seriesOrdinal,
  readingStatus = material.materialId === undefined ? undefined : <SavedMaterialReadingStatus materialId={material.materialId} format={material.format} />,
  resumeLabel,
  showAccessDetails = false,
  variant = "default",
}: MaterialCardProps) {
  const Heading = headingLevel;
  const readerHref = materialReaderHref(material.slug, returnHref);

  if (variant === "series") {
    return <SeriesMaterialRow headingLevel={headingLevel} material={material} readerHref={readerHref} resumeLabel={resumeLabel} ordinal={seriesOrdinal} readingStatus={readingStatus} />;
  }

  if (variant === "row") {
    return (
      <MaterialRow
        headingLevel={headingLevel}
        showAccessDetails={showAccessDetails}
        material={material}
        readerHref={readerHref}
        resumeLabel={resumeLabel}
        rowAnnotation={rowAnnotation}
        readingStatus={readingStatus}
        {...(returnHref === undefined ? {} : { returnHref })}
      />
    );
  }

  if (variant === "feed") {
    const excerpt = material.access === "free" && material.availability === "available" && material.formatSlug === "note" ? material.noteExcerpt : undefined;
    const video = materialPreviewHasVideo(material);
    const duration = materialDuration(material);
    const link = video ? undefined : feedLink(excerpt?.text ?? material.summary, excerpt?.linkUrl);
    const cover = <AccessCover material={material}><ContentCoverImage alt="" className="aspect-video min-h-0 w-full rounded-xl" cover={material.cover ?? null} fallbackKind={video ? "video" : material.formatSlug === "note" ? "note" : "material"} fallbackSeed={material.slug} sizes="(min-width: 768px) 28rem, 100vw" /></AccessCover>;
    return <article className="home-feed-post min-w-0" data-material-id={material.slug} data-material-slug={material.slug} data-material-variant="feed">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">S</span>
        <div className="min-w-0 text-sm"><strong>Sachkov Inside</strong><p className="text-xs text-muted-foreground">{material.format}{material.publishedAt === undefined ? null : <> · <time dateTime={material.publishedAt}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(material.publishedAt))}</time></>}</p></div>
      </div>
      <Heading className="mt-4 text-lg font-semibold leading-snug tracking-[-0.025em]"><Link className="no-underline hover:text-action" href={readerHref} prefetch={false}>{material.title}</Link></Heading>
      <p className="home-feed-post-copy mt-3 text-base text-body-muted">{excerpt?.text ?? material.summary}</p>
      {link === undefined ? <Link className="home-feed-artwork" href={readerHref} prefetch={false} aria-label={video ? `Смотреть: ${material.title}` : `Открыть: ${material.title}`}>
        {cover}
        {video && material.availability === "available" ? <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"><Play aria-hidden="true" className="size-5 fill-current" /></span></span> : null}
        {duration === undefined ? null : <span className="absolute bottom-3 right-3 rounded-md bg-primary px-2 py-1 text-xs tabular-nums text-primary-foreground">{duration}</span>}
      </Link> : <a className="home-feed-artwork home-feed-link-preview" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`Открыть ${link.label} в новой вкладке`}>
        {cover}
        <span className="home-feed-link-domain"><Link2 aria-hidden="true" className="size-4 shrink-0" />{link.label}</span>
      </a>}
      <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <Link className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold no-underline" href={readerHref} prefetch={false}>{video ? "Смотреть видео" : excerpt === undefined || excerpt.truncated ? "Читать дальше" : "Открыть заметку"}<ChevronRight aria-hidden="true" className="size-4" /></Link>
        {readingStatus}
      </div>
    </article>;
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
        {isCompact && resumeLabel !== undefined ? (
          <span className="absolute left-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-accent px-2 py-1 text-[0.625rem] font-semibold leading-4 text-accent-foreground shadow-sm sm:left-3 sm:top-3 sm:gap-1.5 sm:px-2.5 sm:text-[0.6875rem]">
            <Play aria-hidden="true" className="size-3 shrink-0 fill-current" />
            Продолжить просмотр
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
          aria-label={isCompact && resumeLabel !== undefined ? `${material.title}. ${resumeLabel}` : undefined}
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
  resumeLabel,
  readingStatus,
  showAccessDetails,
}: {
  readonly showAccessDetails: boolean;
  readonly headingLevel: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
  readonly resumeLabel: string | undefined;
  readonly returnHref?: Route;
  readonly rowAnnotation?: React.ReactNode;
  readonly readingStatus?: React.ReactNode;
}) {
  const Heading = headingLevel;
  const isVideo = materialPreviewHasVideo(material);
  return (
    <article
      className={cn("group/row relative grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-3 rounded-2xl border border-black/8 bg-muted/55 p-3 shadow-card transition-[box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-card-hover motion-reduce:transform-none motion-reduce:transition-none", resumeLabel !== undefined && "ring-2 ring-accent/70", showAccessDetails && "@max-[13rem]/series-entry:grid-cols-1")}
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant="row"
    >
      <span className={showAccessDetails ? "@max-[13rem]/series-entry:hidden" : undefined}>
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
      </span>
      <span className={cn("min-w-0", showAccessDetails && "[overflow-wrap:anywhere]")}>
        <span className={cn("flex min-w-0 items-center gap-1 text-xs font-semibold text-muted-foreground", showAccessDetails && "flex-wrap")}>
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
        {readingStatus || resumeLabel !== undefined ? <span className="mt-2 flex min-h-6 items-center">
          {resumeLabel === undefined ? readingStatus : <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-action"><Play aria-hidden="true" className="size-3.5 shrink-0 fill-current" />{resumeLabel}</span>}
        </span> : null}
        {showAccessDetails ? <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground" data-series-access>
          {material.availability === "locked" ? <span className="inline-flex items-center gap-1.5 font-medium"><LockKeyhole aria-hidden="true" className="size-3.5" />По подписке</span> : material.availability === "unavailable" ? <span>Не удалось проверить доступ</span> : material.access === "free" ? <span>Бесплатно</span> : null}
          {materialDuration(material) === undefined ? null : <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 aria-hidden="true" className="size-3.5" />{materialDuration(material)}</span>}
        </span> : null}
        {rowAnnotation}
      </span>
      <ChevronRight aria-hidden="true" className={cn("size-4 text-muted-foreground", showAccessDetails && "@max-[13rem]/series-entry:hidden")} />
    </article>
  );
}

/** Compact programme row. Learning outcomes and difficulty remain in the lesson reader. */
function SeriesMaterialRow({ headingLevel: Heading, material, readerHref, resumeLabel, ordinal, readingStatus }: {
  readonly headingLevel: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
  readonly resumeLabel: string | undefined;
  readonly ordinal: number | undefined;
  readonly readingStatus: React.ReactNode;
}) {
  const duration = materialDuration(material);
  const locked = material.availability === "locked";
  const unavailable = material.availability === "unavailable";
  return <article
    className={cn("group/row relative min-h-14 min-w-0 rounded-xl bg-muted/65 px-3 py-2 transition-colors hover:bg-muted focus-within:bg-muted sm:px-4", resumeLabel !== undefined && "bg-secondary")}
    data-material-id={material.slug}
    data-material-slug={material.slug}
    data-material-variant="series"
    data-material-availability={material.availability}
  >
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @max-[16rem]/series-entry:grid-cols-[minmax(0,1fr)_auto]">
      <span className="flex items-baseline gap-1.5 whitespace-nowrap text-xs text-muted-foreground @max-[16rem]/series-entry:col-span-2"><strong className="text-xl font-medium tabular-nums text-foreground">{ordinal}</strong>урок</span>
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-14 shrink-0 overflow-hidden rounded-lg @max-[22rem]/series-entry:hidden"><ContentCoverImage alt="" className={cn("aspect-square min-h-0 w-full rounded-lg", locked && "scale-110 blur-[3px]")} cover={material.cover ?? null} fallbackKind={materialPreviewHasVideo(material) ? "video" : "material"} fallbackSeed={material.slug} sizes="3.5rem" /></span>
        <div className="min-w-0"><Heading className="min-w-0 text-sm font-medium leading-6 [overflow-wrap:anywhere] sm:text-base">
          <Link className="no-underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring" href={readerHref} prefetch={false}>{material.title}</Link>
        </Heading>
        {material.access === "free" && material.availability === "available" ? <span className="mt-1 inline-block rounded-md bg-background px-1.5 py-0.5 text-[0.625rem] font-semibold leading-4 text-action">Бесплатно</span> : null}</div>
      </div>
      <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
        {duration === undefined ? null : <span className="tabular-nums" data-series-duration>{duration}</span>}
        {locked ? <><LockKeyhole aria-hidden="true" className="size-4" /><span className="sr-only">Нужен доступ</span></> : unavailable ? <span className="sr-only">Доступ временно не определён</span> : readingStatus}
      </span>
    </div>
    <span className="mt-1 flex h-6 items-center justify-end text-sm font-semibold text-action" data-series-continuation-slot>
      {resumeLabel === undefined ? null : "Продолжить"}
    </span>
  </article>;
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
