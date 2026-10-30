import {
  ChevronRight,
  Clock3,
  FileText,
  Link2,
  LockKeyhole,
  NotebookPen,
  Play,
  Send,
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

import { LibraryReadMark } from "./library-read-mark.client";
import { SavedMaterialReadingStatus } from "./saved-material-reading-status.client";
import {
  ProductContinuationAction,
  ProductRowArticle,
} from "./product-continuation.client";

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3" | "h4";
  readonly readerContext?: {
    readonly placementId?: string | undefined;
    readonly referenceView?: boolean | undefined;
  };
  readonly material: MaterialPreview;
  readonly returnHref?: Route;
  /** Product-owned context rendered below the row title. */
  readonly rowAnnotation?: React.ReactNode;
  readonly productOrdinal?: number;
  readonly readingStatus?: React.ReactElement;
  readonly showAccessDetails?: boolean;
  /**
   * Доступность читателя ещё уточняется: строка программы нарисована из общих данных, а замок,
   * слово «Бесплатно» или отметка чтения встанут на своё место, когда придёт личная часть (ADR 0027).
   */
  readonly accessPending?: boolean;
  /**
   * Продукт открыт читателю покупкой или тарифом: в строке программы бесплатный урок не отличается
   * от остальных и слова «Бесплатно» не несёт.
   */
  readonly productOpen?: boolean;
  readonly variant: "feed" | "row" | "product" | "library";
}

/** Safe published Material summary rendered in the accepted public visual language. */
export function MaterialCard({
  headingLevel = "h2",
  material,
  returnHref,
  readerContext,
  rowAnnotation,
  productOrdinal,
  readingStatus = material.materialId === undefined ? undefined : (
    <SavedMaterialReadingStatus
      materialId={material.materialId}
      format={material.format}
    />
  ),
  showAccessDetails = false,
  accessPending = false,
  productOpen = false,
  variant,
}: MaterialCardProps) {
  const Heading = headingLevel;
  const readerHref = materialReaderHref(
    material.slug,
    returnHref,
    readerContext,
  );

  if (variant === "product") {
    return (
      <ProductMaterialRow
        accessPending={accessPending}
        headingLevel={headingLevel}
        material={material}
        readerHref={readerHref}
        ordinal={productOrdinal}
        productOpen={productOpen}
        readingStatus={readingStatus}
      />
    );
  }

  if (variant === "library") {
    return (
      <LibraryMaterialCard
        annotation={rowAnnotation}
        headingLevel={headingLevel}
        material={material}
        readerHref={readerHref}
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
  const hasCover =
    material.cover != null && material.cover.renditions.length > 0;
  const cover = hasCover ? (
    <AccessCover material={material}>
      <ContentCoverImage
        alt=""
        className="aspect-video min-h-0 w-full rounded-xl"
        cover={material.cover ?? null}
        fallbackKind={
          video ? "video" : material.formatSlug === "note" ? "note" : "material"
        }
        fallbackSeed={material.slug}
        sizes="(min-width: 768px) 38rem, 100vw"
      />
    </AccessCover>
  ) : null;
  return (
    <article
      className="home-feed-post relative min-w-0"
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant="feed"
    >
      <div className="flex items-center gap-3">
        {/* Pre-sized WebP covers this 32/40px avatar up to DPR 3. */}
        {/* oxlint-disable-next-line next/no-img-element */}
        <img
          alt=""
          className="size-8 shrink-0 rounded-full bg-primary object-cover sm:size-10"
          decoding="async"
          height={120}
          src="/images/sachkov-dev-avatar.webp"
          width={120}
        />
        <div className="min-w-0 text-[0.8125rem] sm:text-sm">
          <strong>Sachkov Dev</strong>
          <p className="text-[0.6875rem] text-muted-foreground sm:text-xs">
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
      {/* Шкала шрифтов карточки (стандарт 09.10.2026): заголовок 15/17 px, текст 14/15 px —
          на телефоне как в программе, на широком экране на ступень крупнее. */}
      <Heading className="mt-3 text-[0.9375rem] font-semibold leading-snug tracking-[-0.02em] sm:mt-4 sm:text-[1.0625rem]">
        <IntentPrefetchLink
          className="no-underline hover:text-action after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          href={readerHref}
        >
          {material.title}
        </IntentPrefetchLink>
      </Heading>
      {!hasCover && material.availability !== "available" ? (
        <IntentPrefetchLink
          className="relative mt-3 flex min-h-24 items-center overflow-hidden rounded-xl p-3 no-underline"
          href={readerHref}
          aria-label={`Открыть: ${material.title}. ${materialAccessLabel(material)}`}
          data-access-text-preview={material.availability}
        >
          {/* Only the public summary is used here; protected bodies never enter a feed card. */}
          <span
            aria-hidden="true"
            className="home-feed-post-copy block select-none text-sm text-body-muted blur-[4px] sm:text-[0.9375rem]"
          >
            {material.summary}
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <MaterialAccessBadge material={material} />
          </span>
        </IntentPrefetchLink>
      ) : (
        <p className="home-feed-post-copy mt-2 text-sm text-body-muted sm:mt-3 sm:text-[0.9375rem]">
          {excerpt?.text ?? material.summary}
        </p>
      )}
      {!hasCover ? (
        link === undefined ? null : (
          <a
            className="home-feed-link-domain relative z-10 no-underline hover:text-foreground"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть ${link.label} в новой вкладке`}
          >
            <Link2 aria-hidden="true" className="size-4 shrink-0" />
            {link.label}
          </a>
        )
      ) : link === undefined ? (
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
          className="home-feed-artwork home-feed-link-preview z-10"
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
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {!hasCover && duration !== undefined ? (
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-3.5" />
            {duration}
          </span>
        ) : null}
        {readingStatus === undefined ? null : (
          <div className="relative z-10">{readingStatus}</div>
        )}
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
          <span className="relative z-10 mt-2 flex min-h-6 items-center">
            {readingStatus}
          </span>
        ) : null}
        {showAccessDetails ? (
          <span
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground"
            data-product-access
          >
            {material.availability === "locked" &&
            material.access !== "free" ? (
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
 * Compact programme row. Learning outcomes and difficulty remain in metadata. The row renders
 * on the server; which lesson continues the reader's path arrives in the browser through
 * `ProductContinuationProvider`.
 */
function ProductMaterialRow({
  accessPending: pending,
  headingLevel: Heading,
  material,
  readerHref,
  ordinal,
  productOpen,
  readingStatus,
}: {
  readonly accessPending: boolean;
  readonly headingLevel: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
  readonly ordinal: number | undefined;
  readonly productOpen: boolean;
  readonly readingStatus: React.ReactNode;
}) {
  // Значок воспроизведения обещает видео, поэтому длительность берётся только у основного видео.
  const duration =
    material.primaryVideoDurationSeconds === undefined
      ? undefined
      : formatDuration(material.primaryVideoDurationSeconds);
  // Бесплатный урок, который откроется после входа (#1825), отмечен словом, а не замком.
  const locked =
    !pending &&
    material.availability === "locked" &&
    material.access !== "free";
  const unavailable = !pending && material.availability === "unavailable";
  return (
    <ProductRowArticle
      availability={pending ? "pending" : material.availability}
      className="group/row relative flex min-h-14 min-w-0 flex-col justify-center rounded-xl bg-muted/65 px-3 py-2.5 transition-colors hover:bg-muted focus-within:bg-muted sm:px-4"
      slug={material.slug}
    >
      {/* Строка в одну линию: номер, название, у урока продолжения компактная кнопка, затем
          длительность видео и справа столбец доступа (решение владельца 29.10.2026, #1837). Формат
          словом не пишется: урок с видео узнаётся по значку и длительности (решение владельца
          29.10.2026). В столбце доступа одна отметка: замок у закрытого урока, слово «Бесплатно»
          акцентным цветом у бесплатного, отметка «изучен» у пройденного, и она занимает место
          слова. В списке уроков с бесплатным уроком столбец у всех строк шириной со слово, поэтому
          слова, замки и длительности стоят колонками; без бесплатных он шириной со значок. Тому, кому
          продукт открыт, слово не показывается (решение владельца 30.10.2026 о купивших курс), а
          ширина столбца остаётся прежней, чтобы личная часть не сдвигала строки. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        {ordinal === undefined ? null : (
          <span
            aria-hidden="true"
            className="w-4 shrink-0 text-left text-xs font-semibold leading-5 tabular-nums text-foreground sm:w-7 sm:text-center sm:text-lg sm:leading-6"
            data-product-preview
          >
            {ordinal}
          </span>
        )}
        <div className="min-w-0 flex-[1_1_112px]">
          <span className="sr-only">
            {ordinal === undefined ? "" : `Урок ${String(ordinal)}. `}
          </span>
          <Heading className="min-w-0 text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6">
            <IntentPrefetchLink
              className="no-underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
              href={readerHref}
            >
              {material.title}
            </IntentPrefetchLink>
          </Heading>
        </div>
        {/* Название начинается с 112 px: если рядом с такой шириной блок справа не помещается, блок
            уходит на следующую строку и там переносится сам. Пиксели, а не rem, чтобы при крупном
            шрифте браузера номер урока оставался рядом с названием. */}
        <span className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <ProductContinuationAction href={readerHref} slug={material.slug} />
          {duration === undefined ? null : (
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              data-product-duration
            >
              <Play aria-hidden="true" className="size-3 fill-current" />
              <span className="sr-only">Видео, </span>
              {duration}
            </span>
          )}
          {/* Ширину столбца решает список уроков (`group/product-order` с
              `data-product-free-lessons` в product-journey-controls): 4.25rem вмещают слово
              «Бесплатно» в text-xs, а меньше слова столбец не станет. Отметка «изучен» приходит из
              ProductMaterialMarker (`data-product-marker-read`) и прячет слово. */}
          <span
            className="flex min-w-5 shrink-0 items-center justify-end group-data-[product-free-lessons]/product-order:min-w-[4.25rem] [&:has([data-product-marker-read])_[data-product-free]]:hidden"
            data-product-status
          >
            {pending ? (
              <span
                aria-hidden="true"
                className="size-4 animate-pulse rounded-full bg-placeholder/40 motion-reduce:animate-none"
                data-product-access-pending
              />
            ) : locked ? (
              <>
                <LockKeyhole aria-hidden="true" className="size-4" />
                <span className="sr-only">Нужен доступ</span>
              </>
            ) : (
              <>
                {material.access === "free" && !productOpen ? (
                  <span
                    className="whitespace-nowrap font-medium text-action"
                    data-product-free
                  >
                    Бесплатно
                  </span>
                ) : null}
                {unavailable ? (
                  <span className="sr-only">Доступ временно не определён</span>
                ) : (
                  readingStatus
                )}
              </>
            )}
          </span>
        </span>
      </div>
    </ProductRowArticle>
  );
}

const libraryFormatIcons = {
  material: FileText,
  note: NotebookPen,
  video: Play,
} as const;

/**
 * Карточка библиотеки (прототип A2, принят владельцем 29.10.2026, #1832): обложка 16:9 или узор
 * формата, на обложке формат, длительность видео и отметка «изучено»; под ней название, описание
 * и, если его передали, место в программе. Карточки одного ряда одной высоты.
 */
function LibraryMaterialCard({
  annotation,
  headingLevel,
  material,
  readerHref,
}: {
  readonly annotation: React.ReactNode;
  readonly headingLevel: "h2" | "h3" | "h4";
  readonly material: MaterialPreview;
  readonly readerHref: Route;
}) {
  const Heading = headingLevel;
  const video = materialPreviewHasVideo(material);
  const kind = video
    ? "video"
    : material.formatSlug === "note"
      ? "note"
      : "material";
  const FormatIcon = libraryFormatIcons[kind];
  const duration = video ? materialDuration(material) : undefined;
  return (
    <article
      className="group/library relative flex h-full min-w-0 flex-col gap-2.5"
      data-material-id={material.slug}
      data-material-slug={material.slug}
      data-material-variant="library"
    >
      <AccessCover material={material}>
        <ContentCoverImage
          alt=""
          className="aspect-video w-full rounded-2xl"
          cover={material.cover ?? null}
          fallbackKind={kind}
          fallbackSeed={material.slug}
          sizes="(min-width: 640px) 24rem, 100vw"
        />
        {material.materialId === undefined ? null : (
          <LibraryReadMark
            format={material.format}
            materialId={material.materialId}
          />
        )}
        <span className="absolute right-2 bottom-2 inline-flex min-h-5 items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums">
          <FormatIcon
            aria-hidden="true"
            className="size-3"
            {...(video ? { fill: "currentColor" } : {})}
          />
          <span className="sr-only">
            {materialTaxonomyLabel(material.format)}
            {duration === undefined ? "" : ", "}
          </span>
          {duration}
        </span>
      </AccessCover>
      <Heading className="mt-0.5 line-clamp-2 text-base leading-6 font-semibold tracking-[-0.02em]">
        <IntentPrefetchLink
          className="no-underline hover:text-action after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-ring"
          href={readerHref}
        >
          {material.title}
        </IntentPrefetchLink>
      </Heading>
      {material.summary.length > 0 ? (
        <p className="line-clamp-2 text-sm leading-5 text-body-muted">
          {material.summary}
        </p>
      ) : null}
      {annotation === undefined ? null : (
        <span className="mt-auto text-xs text-muted-foreground">
          {annotation}
        </span>
      )}
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
        <MaterialAccessBadge compact={compact} material={material} />
      </span>
    </span>
  );
}

function MaterialAccessBadge({
  compact = false,
  material,
}: {
  readonly compact?: boolean;
  readonly material: MaterialPreview;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-white/92 font-semibold text-foreground shadow-xl backdrop-blur-xl",
        compact ? "size-8 justify-center p-0" : "px-3 py-2 text-xs",
      )}
    >
      {material.access === "free" ? (
        <Send aria-hidden="true" className="size-4 text-accent" />
      ) : (
        <LockKeyhole aria-hidden="true" className="size-4 text-accent" />
      )}
      {compact ? (
        <span className="sr-only">{materialAccessLabel(material)}</span>
      ) : (
        materialAccessLabel(material)
      )}
    </span>
  );
}

function materialDuration(material: MaterialPreview): string | undefined {
  return material.primaryVideoDurationSeconds === undefined
    ? material.preview?.duration
    : formatDuration(material.primaryVideoDurationSeconds);
}

function materialAccessLabel(material: MaterialPreview): string {
  // Бесплатный урок курса закрыт гостю до входа через Telegram, а не до покупки (#1825).
  if (material.availability === "locked")
    return material.access === "free" ? "Бесплатно" : "Для участников";
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
