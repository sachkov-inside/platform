import {
  BookOpenText,
  ChevronRight,
  CirclePlay,
  Clock3,
  FileText,
  Link2,
  LockKeyhole,
  Play,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";

import { cn } from "@/shared/lib/utils";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
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
import {
  SeriesContinuationSlot,
  SeriesRowArticle,
} from "./series-continuation.client";

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly returnHref?: Route;
  /** Series-owned context rendered below the row title. */
  readonly rowAnnotation?: React.ReactNode;
  readonly seriesOrdinal?: number;
  readonly readingStatus?: React.ReactElement;
  readonly showAccessDetails?: boolean;
  /**
   * Доступность читателя ещё уточняется: строка программы нарисована из общих данных, а замок или
   * отметка чтения встанут на своё место, когда придёт личная часть (ADR 0027).
   */
  readonly accessPending?: boolean;
  readonly variant: "feed" | "row" | "series";
}

/** Safe published Material summary rendered in the accepted public visual language. */
export function MaterialCard({
  headingLevel = "h2",
  material,
  returnHref,
  rowAnnotation,
  seriesOrdinal,
  readingStatus = material.materialId === undefined ? undefined : (
    <SavedMaterialReadingStatus
      materialId={material.materialId}
      format={material.format}
    />
  ),
  showAccessDetails = false,
  accessPending = false,
  variant,
}: MaterialCardProps) {
  const Heading = headingLevel;
  const readerHref = materialReaderHref(material.slug, returnHref);

  if (variant === "series") {
    return (
      <SeriesMaterialRow
        accessPending={accessPending}
        headingLevel={headingLevel}
        material={material}
        readerHref={readerHref}
        ordinal={seriesOrdinal}
        readingStatus={readingStatus}
      />
    );
  }

  if (variant === "row") {
    return (
      <MaterialRow
        headingLevel={headingLevel}
        showAccessDetails={showAccessDetails}
        material={material}
        readerHref={readerHref}
        rowAnnotation={rowAnnotation}
        readingStatus={readingStatus}
        {...(returnHref === undefined ? {} : { returnHref })}
      />
    );
  }

  const excerpt =
    material.access === "free" &&
    material.availability === "available" &&
    material.formatSlug === "note"
      ? material.noteExcerpt
      : undefined;
  const video = materialPreviewHasVideo(material);
  const duration = materialDuration(material);
  const link = video
    ? undefined
    : feedLink(excerpt?.text ?? material.summary, excerpt?.linkUrl);
  const cover = (
    <AccessCover material={material}>
      <ContentCoverImage
        alt=""
        className="aspect-video min-h-0 w-full rounded-xl"
        cover={material.cover ?? null}
        fallbackKind={
          video ? "video" : material.formatSlug === "note" ? "note" : "material"
        }
        fallbackSeed={material.slug}
        sizes="(min-width: 768px) 28rem, 100vw"
      />
    </AccessCover>
  );
  return (
    <article
      className="home-feed-post min-w-0"
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant="feed"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
        >
          S
        </span>
        <div className="min-w-0 text-sm">
          <strong>Sachkov Inside</strong>
          <p className="text-xs text-muted-foreground">
            {material.format}
            {material.publishedAt === undefined ? null : (
              <>
                {" "}
                ·{" "}
                <time dateTime={material.publishedAt}>
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "Europe/Moscow",
                  }).format(new Date(material.publishedAt))}
                </time>
              </>
            )}
          </p>
        </div>
      </div>
      <Heading className="mt-4 text-lg font-semibold leading-snug tracking-[-0.025em]">
        <IntentPrefetchLink
          className="no-underline hover:text-action"
          href={readerHref}
        >
          {material.title}
        </IntentPrefetchLink>
      </Heading>
      <p className="home-feed-post-copy mt-3 text-base text-body-muted">
        {excerpt?.text ?? material.summary}
      </p>
      {link === undefined ? (
        <IntentPrefetchLink
          className="home-feed-artwork"
          href={readerHref}
          aria-label={
            video ? `Смотреть: ${material.title}` : `Открыть: ${material.title}`
          }
        >
          {cover}
          {video && material.availability === "available" ? (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
                <Play aria-hidden="true" className="size-5 fill-current" />
              </span>
            </span>
          ) : null}
          {duration === undefined ? null : (
            <span className="absolute bottom-3 right-3 rounded-md bg-primary px-2 py-1 text-xs tabular-nums text-primary-foreground">
              {duration}
            </span>
          )}
        </IntentPrefetchLink>
      ) : (
        <a
          className="home-feed-artwork home-feed-link-preview"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Открыть ${link.label} в новой вкладке`}
        >
          {cover}
          <span className="home-feed-link-domain">
            <Link2 aria-hidden="true" className="size-4 shrink-0" />
            {link.label}
          </span>
        </a>
      )}
      <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <IntentPrefetchLink
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold no-underline"
          href={readerHref}
        >
          {video
            ? "Смотреть видео"
            : excerpt === undefined || excerpt.truncated
              ? "Читать дальше"
              : "Открыть заметку"}
          <ChevronRight aria-hidden="true" className="size-4" />
        </IntentPrefetchLink>
        {readingStatus}
      </div>
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
  showAccessDetails,
}: {
  readonly showAccessDetails: boolean;
  readonly headingLevel: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
  readonly returnHref?: Route;
  readonly rowAnnotation?: React.ReactNode;
  readonly readingStatus?: React.ReactElement | undefined;
}) {
  const Heading = headingLevel;
  const isVideo = materialPreviewHasVideo(material);
  return (
    <article
      className={cn(
        "group/row relative grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-3 rounded-2xl border border-black/8 bg-muted/55 p-3 shadow-card transition-[box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-card-hover motion-reduce:transform-none motion-reduce:transition-none",
        showAccessDetails && "@max-[13rem]/series-entry:grid-cols-1",
      )}
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant="row"
    >
      <span
        className={
          showAccessDetails ? "@max-[13rem]/series-entry:hidden" : undefined
        }
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
      </span>
      <span
        className={cn(
          "min-w-0",
          showAccessDetails && "[overflow-wrap:anywhere]",
        )}
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-1 text-xs font-semibold text-muted-foreground",
            showAccessDetails && "flex-wrap",
          )}
        >
          <span>{materialTaxonomyLabel(material.format)}</span>
          <span aria-hidden="true">·</span>
          <IntentPrefetchLink
            className="relative z-10 truncate no-underline hover:text-foreground"
            href={collectionDiscoveryHref(
              "topic",
              material.topicSlug,
              returnHref,
            )}
          >
            {material.topic}
          </IntentPrefetchLink>
        </span>
        <Heading className="mt-1 line-clamp-3 text-sm font-semibold leading-5 tracking-[-0.02em] sm:line-clamp-2 sm:text-base">
          <IntentPrefetchLink
            className="no-underline after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            href={readerHref}
          >
            {material.title}
          </IntentPrefetchLink>
        </Heading>
        {isVideo && material.summary.length > 0 ? (
          <span className="mt-2 line-clamp-3 break-words text-sm leading-5 text-body-muted">
            {material.summary}
          </span>
        ) : null}
        {readingStatus !== undefined ? (
          <span className="mt-2 flex min-h-6 items-center">
            {readingStatus}
          </span>
        ) : null}
        {showAccessDetails ? (
          <span
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground"
            data-series-access
          >
            {material.availability === "locked" ? (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <LockKeyhole aria-hidden="true" className="size-3.5" />
                По подписке
              </span>
            ) : material.availability === "unavailable" ? (
              <span>Не удалось проверить доступ</span>
            ) : material.access === "free" ? (
              <span>Бесплатно</span>
            ) : null}
            {materialDuration(material) === undefined ? null : (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock3 aria-hidden="true" className="size-3.5" />
                {materialDuration(material)}
              </span>
            )}
          </span>
        ) : null}
        {rowAnnotation}
      </span>
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "size-4 text-muted-foreground",
          showAccessDetails && "@max-[13rem]/series-entry:hidden",
        )}
      />
    </article>
  );
}

/**
 * Compact programme row. Learning outcomes and difficulty remain in the lesson reader. The row renders
 * on the server; which lesson continues the reader's path arrives in the browser through
 * `SeriesContinuationProvider`.
 */
function SeriesMaterialRow({
  accessPending,
  headingLevel: Heading,
  material,
  readerHref,
  ordinal,
  readingStatus,
}: {
  readonly accessPending: boolean;
  readonly headingLevel: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
  readonly ordinal: number | undefined;
  readonly readingStatus: React.ReactNode;
}) {
  const duration = materialDuration(material);
  // Бесплатный урок открыт каждому, поэтому уточнять у него нечего.
  const pending = accessPending && material.access !== "free";
  const locked = !pending && material.availability === "locked";
  const unavailable = !pending && material.availability === "unavailable";
  return (
    <SeriesRowArticle
      availability={pending ? "pending" : material.availability}
      className="group/row relative flex min-h-14 min-w-0 items-center rounded-xl bg-muted/65 px-3 py-2.5 transition-colors hover:bg-muted focus-within:bg-muted sm:min-h-16 sm:px-4 sm:py-3"
      slug={material.slug}
    >
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
          {/* Номер урока — мелкая цифра у первой строки названия, без плитки и обложки: на узком
              экране название получает почти всю ширину (решение владельца 09.10.2026). */}
          {ordinal === undefined ? null : (
            <span
              aria-hidden="true"
              className="w-6 shrink-0 pt-px text-sm font-semibold leading-6 tabular-nums text-muted-foreground sm:w-7 sm:text-base"
              data-series-preview
            >
              {String(ordinal).padStart(2, "0")}
            </span>
          )}
          <div className="min-w-0">
            {ordinal === undefined ? null : (
              <span className="sr-only">Урок {ordinal}. </span>
            )}
            <Heading className="min-w-0 text-sm font-medium leading-6 [overflow-wrap:anywhere] sm:text-base">
              <IntentPrefetchLink
                className="no-underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
                href={readerHref}
              >
                {material.title}
              </IntentPrefetchLink>
            </Heading>
            <SeriesRowMeta duration={duration} material={material} />
          </div>
        </div>
        <span className="flex min-w-5 flex-col items-end justify-center @min-[30rem]/series-entry:min-w-20 gap-1 text-xs text-muted-foreground">
          {pending ? (
            <span
              aria-hidden="true"
              className="size-4 animate-pulse rounded-full bg-placeholder/40 motion-reduce:animate-none"
              data-series-access-pending
            />
          ) : locked ? (
            <>
              <LockKeyhole aria-hidden="true" className="size-4" />
              <span className="sr-only">Нужен доступ</span>
            </>
          ) : unavailable ? (
            <span className="sr-only">Доступ временно не определён</span>
          ) : (
            readingStatus
          )}
          <SeriesContinuationSlot slug={material.slug} />
        </span>
      </div>
    </SeriesRowArticle>
  );
}

const formatIcons: Readonly<Record<string, LucideIcon>> = {
  video: CirclePlay,
  guide: BookOpenText,
};

/**
 * Строка под названием урока: значок и формат, длительность видео и пометка «Бесплатно». По ней
 * видно, где видео, а где текст, без обложек: в программе номер урока и есть его рисунок
 * (решение владельца 09.10.2026). Задания отмечает своя строка задания.
 */
function SeriesRowMeta({
  duration,
  material,
}: {
  readonly duration: string | undefined;
  readonly material: MaterialPreview;
}) {
  const Icon =
    formatIcons[
      materialPreviewHasVideo(material) ? "video" : (material.formatSlug ?? "")
    ] ?? FileText;
  const free =
    material.access === "free" && material.availability === "available";
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{material.format}</span>
      {duration === undefined ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums" data-series-duration>
            {duration}
          </span>
        </>
      )}
      {free ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-action">Бесплатно</span>
        </>
      ) : null}
    </span>
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
