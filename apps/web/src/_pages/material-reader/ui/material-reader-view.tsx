import { ChevronLeft, ChevronRight, List } from "lucide-react";
import { type ReactNode } from "react";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
  ReaderText,
  PrimaryVideoPresentation,
} from "@/_pages/material-reader/model/material-reader-view";
import type { SeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import {
  materialTaxonomyLabel,
  MaterialBodyView,
  materialSourceAnchors,
} from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";
import {
  MaterialAssetFile,
  MaterialAssetImage,
} from "@/features/material-assets";
import { MaterialPrimaryVideo } from "@/features/material-video";
import {
  homeMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { topicPath } from "@/shared/routing/public-page-path";

import { agentChoiceComparison } from "../model/agent-choice-comparison";
import { projectHarnessIllustrations } from "@/features/project-harness";

import { ReaderReturnNavigation } from "./reader-return-navigation.client";
import {
  CourseReadingLayout,
  CourseReadingHeader,
  CourseReadingFooter,
  type CourseReadingContext,
} from "@/features/library-discovery";
import { ReaderTopActions } from "./reader-top-actions.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";

export interface MaterialReaderViewProps {
  readonly body: readonly ReaderBlock[];
  readonly material: MaterialReaderMetadata;
  readonly primaryVideo: PrimaryVideoPresentation | null;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly seriesContext?: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
  readonly topReadingAction?: ReactNode;
  readonly topBookmarkAction?: ReactNode;
  readonly practiceActions?: ReactNode;
  /** Streaming public-lesson practice shares the action row; an empty result has no extra row. */
  readonly deferredPracticeActions?: ReactNode;
  /**
   * Подсказка о двух режимах и место, куда она встаёт: перед шагом с этим номером. Место выбирает
   * страница, потому что подсказка должна стоять у шага, который читатель действительно видит.
   */
  readonly modeHint?: { readonly at: number; readonly node: ReactNode };
  /** Переключатель режима прохождения; у руководства без вариантных шагов его нет. */
  readonly modeSwitch?: ReactNode;
}

interface OutlineItem {
  readonly id: string;
  readonly label: string;
  readonly level: 2 | 3 | 4;
}

/** Client-safe presentation shared by the production RSC route and Storybook. */
export function MaterialReaderView({
  body,
  material,
  primaryVideo,
  returnTarget = homeMaterialReaderReturnTarget,
  seriesContext = null,
  readingAction,
  bookmarkAction,
  topReadingAction,
  topBookmarkAction,
  practiceActions,
  deferredPracticeActions,
  modeHint,
  modeSwitch,
}: MaterialReaderViewProps) {
  const anchors = materialSourceAnchors(body);
  const outline = collectOutline(body, [], anchors);

  return (
    <div
      className="@container/material-reader"
      data-material-id={material.materialId}
      data-material-reader-state="available"
    >
      <ReaderFrame
        context={seriesContext}
        repeatAtBottom={seriesContext === null}
        hideReturn={seriesContext !== null}
        target={returnTarget}
        topNavigation={
          <ReaderTopActions
            context={seriesContext}
            readingAction={topReadingAction}
            bookmarkAction={topBookmarkAction}
            returnAction={
              <CatalogBackLink
                href={returnTarget.href}
                label={returnTarget.label}
              />
            }
          />
        }
      >
        <div className="mx-auto min-w-0 max-w-[43rem]">
          <MaterialReaderHeader
            material={material}
            programme={seriesContext?.programme}
            actions={
              <>
                {topBookmarkAction ?? bookmarkAction}
                {topReadingAction ?? readingAction}
              </>
            }
          />
          {modeSwitch}
          {primaryVideo === null ? null : (
            <MaterialPrimaryVideo
              className="max-w-none"
              key={primaryVideo.videoId}
              materialId={material.materialId}
              video={primaryVideo}
              showWatchedAction={readingAction === undefined}
            />
          )}
          <ReaderOutline items={outline} />
          <article
            className="mt-8 min-w-0 break-words text-pretty text-[0.9375rem] leading-[1.65] text-foreground sm:text-base md:text-lg [&_h2:not([data-quiz-heading])]:text-lg [&_h3:not([data-comparison-heading])]:text-base [&_h4]:text-[0.9375rem] sm:[&_h2:not([data-quiz-heading])]:text-xl sm:[&_h3:not([data-comparison-heading])]:text-lg sm:[&_h4]:text-base md:[&_h2:not([data-quiz-heading])]:text-2xl md:[&_h3:not([data-comparison-heading])]:text-xl md:[&_h4]:text-lg"
            data-reader-body
          >
            <ReaderBlocks
              blocks={body}
              contentVersion={material.contentVersion}
              materialId={material.materialId}
              materialSlug={material.slug}
              path={[]}
              {...(modeHint === undefined
                ? {}
                : { hint: modeHint.node, hintAt: modeHint.at })}
            />
          </article>
          {practiceActions}
          {bookmarkAction === undefined &&
          readingAction === undefined &&
          deferredPracticeActions === undefined &&
          seriesContext === null ? null : (
            <div className="mt-5" data-material-actions data-reader-footer>
              {seriesContext?.programme == null ? (
                <ReaderTopActions
                  position="bottom"
                  context={seriesContext}
                  bookmarkAction={topBookmarkAction ?? bookmarkAction}
                  readingAction={topReadingAction ?? readingAction}
                />
              ) : (
                <CourseReadingFooter context={seriesContext.programme} />
              )}
              {deferredPracticeActions === undefined ? null : (
                <div
                  className="mt-2 flex flex-wrap items-start"
                  data-reader-practice-actions
                >
                  {deferredPracticeActions}
                </div>
              )}
            </div>
          )}
        </div>
      </ReaderFrame>
      <SeriesReaderBar context={seriesContext} />
    </div>
  );
}

/**
 * Нижняя панель урока внутри продукта на телефоне и планшете (решение владельца 09.10.2026):
 * предыдущий урок, программа с номером урока, следующий урок. Внутри курса она заменяет общую
 * навигацию снизу: Главной там нет, на неё ведёт логотип в шапке, и случайно уйти из курса
 * нельзя. Кнопки 44 px (зона нажатия); недоступный шаг остаётся на месте приглушённым.
 */
export function SeriesReaderBar({
  context,
}: {
  readonly context: SeriesReaderContext | null;
}) {
  if (context === null || context.programme != null) return null;
  const step =
    "grid size-11 place-items-center rounded-lg text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <>
      {/* Место под панель в конце урока: последние строки не прячутся за ней. */}
      <div aria-hidden="true" className="h-16 lg:hidden" />
      <nav
        aria-label="Уроки продукта"
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-0 rounded-xl border border-border bg-background/95 p-0 shadow-sm backdrop-blur lg:hidden"
        data-series-reader-bar
      >
        <HidePublicFooter />
        {context.previous === null ? (
          <span
            aria-hidden="true"
            className={cn(step, "text-muted-foreground/40")}
          >
            <ChevronLeft className="size-5" />
          </span>
        ) : (
          <IntentPrefetchLink
            aria-label="Предыдущий урок"
            className={step}
            href={context.previous.href}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </IntentPrefetchLink>
        )}
        <IntentPrefetchLink
          aria-label={`Программа, урок ${String(context.currentPosition)} из ${String(context.totalMaterials)}`}
          className="inline-flex min-h-11 min-w-14 items-center justify-center whitespace-nowrap rounded-lg px-2 text-xs font-medium tabular-nums text-muted-foreground no-underline hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          title="Открыть программу"
          href={context.series.href}
        >
          {context.currentPosition} / {context.totalMaterials}
        </IntentPrefetchLink>
        {context.next === null ? (
          <span
            aria-hidden="true"
            className={cn(step, "text-muted-foreground/40")}
          >
            <ChevronRight className="size-5" />
          </span>
        ) : (
          <IntentPrefetchLink
            aria-label="Следующий урок"
            className={step}
            href={context.next.href}
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </IntentPrefetchLink>
        )}
      </nav>
    </>
  );
}

export function MaterialReaderHeader({
  material,
  programme,
  actions,
}: {
  readonly material: MaterialReaderMetadata;
  readonly programme?: CourseReadingContext | null | undefined;
  readonly actions?: ReactNode;
}) {
  const publicationDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(material.publishedAt));

  if (programme != null)
    return (
      <CourseReadingHeader
        context={programme}
        title={material.title}
        actions={actions}
        metadata={
          <>
            <time dateTime={material.publishedAt}>{publicationDate}</time>
          </>
        }
      />
    );
  return (
    <header className="flex min-w-0 flex-col" data-reader-header>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
        <span className="font-semibold text-foreground">
          {materialTaxonomyLabel(material.format.name)}
        </span>
        <span aria-hidden="true">·</span>
        <IntentPrefetchLink
          className="no-underline hover:text-foreground focus-visible:outline-ring"
          href={topicPath(material.topic.slug)}
        >
          {material.topic.name}
        </IntentPrefetchLink>
        <span aria-hidden="true">·</span>
        <time dateTime={material.publishedAt}>{publicationDate}</time>
      </div>
      <h1 className="mt-3 break-words text-balance text-[1.375rem] font-semibold leading-[1.2] tracking-[-0.025em] sm:mt-4 sm:text-2xl md:text-[1.75rem]">
        {material.title}
      </h1>
    </header>
  );
}

export function MaterialReaderFooter({
  seriesContext,
  format = "guide",
}: {
  readonly seriesContext: SeriesReaderContext | null;
  readonly format?: string;
}) {
  if (seriesContext === null) return null;
  if (seriesContext.programme != null)
    return <CourseReadingFooter context={seriesContext.programme} />;

  return (
    <footer className="mt-5" data-reader-footer>
      <ReaderTopActions
        position="bottom"
        context={seriesContext}
        format={format}
      />
    </footer>
  );
}

function ReaderOutline({ items }: { readonly items: readonly OutlineItem[] }) {
  if (items.length === 0) {
    return null;
  }

  const links = items.map((item) => (
    <li key={item.id}>
      <a
        className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
        href={`#${item.id}`}
      >
        {item.label}
      </a>
    </li>
  ));

  return (
    <div className="mt-6 border-y border-black/8 py-1 sm:mt-8 sm:py-2">
      <details>
        <summary
          aria-label={`Содержание: ${String(items.length)}`}
          className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-lg px-1 text-sm font-semibold focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <List aria-hidden="true" className="size-4 text-action" />
            Содержание · {items.length}
          </span>
        </summary>
        <nav
          aria-label="В этом материале"
          className="border-t border-black/8 pb-2 pt-3"
        >
          <ul className="grid gap-2" role="list">
            {links}
          </ul>
        </nav>
      </details>
    </div>
  );
}

function ReaderBlocks({
  blocks,
  contentVersion,
  hint,
  hintAt,
  materialId,
  materialSlug,
  path,
}: {
  readonly blocks: readonly ReaderBlock[];
  readonly contentVersion: number;
  readonly hint?: ReactNode;
  readonly hintAt?: number;
  readonly materialId: string;
  readonly materialSlug: string;
  readonly path: readonly number[];
}) {
  const harness = projectHarnessIllustrations(
    materialSlug,
    contentVersion,
    blocks,
  );
  return (
    <MaterialBodyView
      blocks={blocks}
      comparison={agentChoiceComparison(materialSlug, blocks)}
      illustrations={harness?.illustrations}
      hint={hint}
      hintAt={hintAt}
      path={path}
      rendering={{
        headingId,
        image: (block) =>
          harness?.replacesOverview === true ? null : (
            <MaterialAssetImage
              {...block}
              materialId={materialId}
              contentVersion={contentVersion}
            />
          ),
        file: (block) => (
          <MaterialAssetFile
            {...block}
            materialId={materialId}
            contentVersion={contentVersion}
          />
        ),
      }}
    />
  );
}

function collectOutline(
  blocks: readonly ReaderBlock[],
  path: readonly number[] = [],
  anchors: ReadonlyMap<string, string> = materialSourceAnchors(blocks),
): OutlineItem[] {
  return blocks.flatMap((block, index): OutlineItem[] => {
    const blockPath = [...path, index];
    if (block.kind === "heading") {
      return [
        {
          id: anchors.get(blockPath.join("-")) ?? headingId(blockPath),
          label: textContent(block.content),
          level: block.level,
        },
      ];
    }
    if (block.kind === "blockquote" || block.kind === "callout") {
      return collectOutline(block.content, blockPath, anchors);
    }
    if (block.kind === "bullet_list" || block.kind === "ordered_list") {
      return block.items.flatMap((item, itemIndex) =>
        collectOutline(item, [...blockPath, itemIndex], anchors),
      );
    }
    return [];
  });
}

function headingId(path: readonly number[]): string {
  return `material-section-${path.join("-")}`;
}

function textContent(content: readonly ReaderText[]): string {
  return content.map(({ text }) => text).join("");
}

/** Course pages share the accepted frame; independent Materials keep their original return controls. */
export function ReaderFrame({
  context,
  children,
  ...props
}: React.ComponentProps<typeof ReaderReturnNavigation> & {
  readonly context: SeriesReaderContext | null;
}) {
  return context?.programme == null ? (
    <ReaderReturnNavigation {...props}>{children}</ReaderReturnNavigation>
  ) : (
    <CourseReadingLayout context={context.programme}>
      {children}
    </CourseReadingLayout>
  );
}
