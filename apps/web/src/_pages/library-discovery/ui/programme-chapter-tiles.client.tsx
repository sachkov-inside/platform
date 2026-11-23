"use client";

import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import type { Route } from "next";
import { useId, useRef, type ReactNode } from "react";

import type { ProductChapterRoadmapStatus } from "@/features/library-discovery";
import {
  dialogInitialFocus,
  useNativeDialog,
} from "@/shared/lib/native-dialog.client";
import { Button } from "@/shared/ui/button";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import type { ChapterArt, ChapterTone } from "../model/chapter-tile-art";
import { ChapterArtwork } from "./chapter-artwork";
import {
  ChapterReadingProgress,
  useChapterReading,
} from "./chapter-reading-progress.client";
import { formatLessonCount, formatOfLessons } from "./product-counts";
import styles from "./programme-chapter-tiles.module.css";

/** Плитка главы: всё, что о главе известно на сервере. */
export interface JourneyChapterTile {
  readonly number: number;
  readonly status: ProductChapterRoadmapStatus;
  readonly art: ChapterArt;
  readonly tone: ChapterTone;
  /** Первый абзац описания главы. */
  readonly outcome: string;
  /** Опубликованные уроки главы: по их отметкам считается прогресс. */
  readonly materialIds: readonly string[];
  /** Объявленные, но ещё не опубликованные уроки главы в работе. */
  readonly upcomingCount: number;
}

export interface TiledChapter {
  readonly id: string;
  readonly name: string;
  readonly tile: JourneyChapterTile;
}

/** Действие окна главы: урок продолжения, если он в этой главе. */
export interface ChapterContinuation {
  readonly href: Route;
  readonly label: string;
  readonly title: string;
}

/**
 * Главы программы плитками (решение владельца 23.11.2026, прототип `prototype/course-chapter-tiles`).
 * Уроки главы открываются в окне посередине экрана, на телефоне шторкой снизу. Окно одной высоты
 * для любой главы, чтобы при листании стрелками оно не меняло размер. Строки уроков в окне те же,
 * что рисует сервер для программы.
 */
export function ProgrammeChapterTiles({
  chapters,
  continuation,
  currentId,
  openId,
  onOpenChange,
  children,
}: {
  readonly chapters: readonly TiledChapter[];
  readonly continuation: ChapterContinuation | null;
  /** Глава урока продолжения: её плитка отмечена «Сейчас». */
  readonly currentId: string | null;
  readonly openId: string | null;
  readonly onOpenChange: (id: string | null) => void;
  /** Содержимое открытой главы: описание, задания и уроки. */
  readonly children: ReactNode;
}) {
  const gridRef = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const index = chapters.findIndex((chapter) => chapter.id === openId);
  const opened = index === -1 ? undefined : chapters[index];
  // Focus returns to the tile of the chapter the window showed last, not to the tile that opened
  // it: the arrows may have paged to another chapter.
  const closedChapter = useRef<string | null>(null);
  const close = () => {
    closedChapter.current = openId;
    onOpenChange(null);
  };
  const { ref, ...dialogEvents } = useNativeDialog({
    open: opened !== undefined,
    onOpenChange: (open) => {
      if (!open) close();
    },
  });
  const previous = index > 0 ? chapters[index - 1] : undefined;
  const next = index === -1 ? undefined : chapters[index + 1];

  return (
    <>
      <ol aria-label="Главы" className={styles["grid"]} ref={gridRef}>
        {chapters.map((chapter) => (
          <li className={styles["cell"]} key={chapter.id}>
            <ChapterTile
              chapter={chapter}
              current={chapter.id === currentId}
              onOpen={() => {
                onOpenChange(chapter.id);
              }}
            />
          </li>
        ))}
      </ol>
      <dialog
        aria-labelledby={titleId}
        className={styles["dialog"]}
        data-chapter-window={opened?.id}
        ref={ref}
        {...dialogEvents}
        onClose={(event) => {
          dialogEvents.onClose(event);
          // The close event follows the browser's own focus restoration, so this focus wins.
          const last = closedChapter.current;
          closedChapter.current = null;
          if (last === null) return;
          gridRef.current
            ?.querySelector<HTMLButtonElement>(
              `[data-chapter-tile="${CSS.escape(last)}"]`,
            )
            ?.focus();
        }}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element outside its box.
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientY < rect.top ||
            event.clientY > rect.bottom ||
            event.clientX < rect.left ||
            event.clientX > rect.right
          )
            close();
        }}
      >
        {opened === undefined ? null : (
          <>
            <ChapterArtwork
              art={opened.tile.art}
              className={styles["windowArt"]}
              muted={opened.tile.status === "planned"}
              tone={opened.tile.tone}
            >
              <button
                aria-label="Закрыть главу"
                className={styles["close"]}
                onClick={close}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </ChapterArtwork>
            {/* A new chapter starts at its top, not at the scroll of the previous one. */}
            <div className={styles["windowBody"]} key={opened.id}>
              <div>
                <p className={styles["eyebrow"]}>
                  {`Глава ${String(opened.tile.number)}${lessonCount(opened.tile)}`}
                </p>
                {/* Focus starts at the title, so opening or paging does not highlight Close. */}
                <h2
                  className={styles["windowTitle"]}
                  id={titleId}
                  ref={dialogInitialFocus}
                  tabIndex={-1}
                >
                  {opened.name}
                  <StatusBadge status={opened.tile.status} />
                </h2>
                {opened.tile.outcome === "" ? null : (
                  <p className={styles["outcome"]}>{opened.tile.outcome}</p>
                )}
              </div>
              <WindowProgress chapter={opened} />
              {continuation === null ? null : (
                <Button
                  asChild
                  className={styles["continue"]}
                  data-chapter-continue
                  size="lg"
                >
                  <IntentPrefetchLink href={continuation.href}>
                    <span>
                      {continuation.label}: {continuation.title}
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </IntentPrefetchLink>
                </Button>
              )}
              <div className={styles["content"]}>{children}</div>
            </div>
            <nav aria-label="Другие главы" className={styles["pager"]}>
              <Button
                disabled={previous === undefined}
                onClick={() => {
                  if (previous !== undefined) onOpenChange(previous.id);
                }}
                variant="ghost"
              >
                <ArrowLeft aria-hidden="true" />
                Предыдущая
                {previous === undefined ? null : (
                  <span className="sr-only">: {previous.name}</span>
                )}
              </Button>
              <Button
                disabled={next === undefined}
                onClick={() => {
                  if (next !== undefined) onOpenChange(next.id);
                }}
                variant="ghost"
              >
                Следующая
                {next === undefined ? null : (
                  <span className="sr-only">: {next.name}</span>
                )}
                <ArrowRight aria-hidden="true" />
              </Button>
            </nav>
          </>
        )}
      </dialog>
    </>
  );
}

function lessonCount(tile: JourneyChapterTile): string {
  const total = tile.materialIds.length + tile.upcomingCount;
  if (total === 0) return "";
  if (tile.upcomingCount > 0)
    return ` · готово ${String(tile.materialIds.length)} ${formatOfLessons(total)}`;
  return ` · ${formatLessonCount(total)}`;
}

/** Подпись статуса главы; у готовой главы метки нет. */
const statusLabels: Readonly<
  Record<Exclude<ProductChapterRoadmapStatus, "done">, string>
> = {
  planned: "В планах",
  writing: "Пишется",
};

function StatusBadge({
  status,
}: {
  readonly status: ProductChapterRoadmapStatus;
}) {
  if (status === "done") return null;
  return (
    <>
      {" "}
      <span className={styles["badge"]} data-chapter-badge={status}>
        {statusLabels[status]}
      </span>
    </>
  );
}

function ChapterTile({
  chapter,
  current,
  onOpen,
}: {
  readonly chapter: TiledChapter;
  readonly current: boolean;
  readonly onOpen: () => void;
}) {
  const { tile } = chapter;
  return (
    <button
      className={styles["tile"]}
      data-chapter-status={tile.status}
      data-chapter-tile={chapter.id}
      data-current={current ? "" : undefined}
      onClick={onOpen}
      type="button"
    >
      <ChapterArtwork
        art={tile.art}
        className={styles["tileArt"]}
        muted={tile.status === "planned"}
        tone={tile.tone}
      >
        {current ? (
          <span className={styles["badge"]} data-chapter-badge="current">
            Сейчас
          </span>
        ) : tile.status === "done" ? null : (
          <span className={styles["badge"]} data-chapter-badge={tile.status}>
            {statusLabels[tile.status]}
          </span>
        )}
      </ChapterArtwork>
      <span className={styles["tileBody"]}>
        <span className={styles["eyebrow"]}>
          {`Глава ${String(tile.number)}`}
        </span>
        <span className={styles["tileTitle"]}>{chapter.name}</span>
        <TileProgress chapter={chapter} />
      </span>
    </button>
  );
}

/** Низ плитки: изученное с полоской, «Изучено» или число уроков, пока читатель не начал главу. */
function TileProgress({ chapter }: { readonly chapter: TiledChapter }) {
  const { tile } = chapter;
  const { connect, missing, read, total } = useChapterReading(tile.materialIds);
  if (total === 0)
    return (
      <span className={styles["tileFoot"]}>
        {tile.status === "planned" ? "Скоро" : "Готовится"}
      </span>
    );
  if (!missing && read === total)
    return (
      <span className={styles["tileFoot"]} ref={connect}>
        <span className={styles["studied"]}>
          <Check aria-hidden="true" />
          Изучено
        </span>
      </span>
    );
  if (missing || read === 0)
    return (
      <span className={styles["tileFoot"]} ref={connect}>
        {formatLessonCount(total)}
      </span>
    );
  return (
    <span className={styles["tileFoot"]} ref={connect}>
      <ChapterReadingProgress
        materialIds={tile.materialIds}
        name={chapter.name}
      />
      <span aria-hidden="true" className={styles["meter"]}>
        <span style={{ width: `${String((read / total) * 100)}%` }} />
      </span>
    </span>
  );
}

function WindowProgress({ chapter }: { readonly chapter: TiledChapter }) {
  const { read, total, missing } = useChapterReading(chapter.tile.materialIds);
  if (total === 0) return null;
  return (
    <div className={styles["progress"]}>
      <div className={styles["progressLine"]}>
        <ChapterReadingProgress
          materialIds={chapter.tile.materialIds}
          name={chapter.name}
          sentence
        />
        {missing ? null : (
          <span>{String(Math.round((read / total) * 100))}%</span>
        )}
      </div>
      <span aria-hidden="true" className={styles["meter"]}>
        <span style={{ width: `${String((read / total) * 100)}%` }} />
      </span>
    </div>
  );
}
