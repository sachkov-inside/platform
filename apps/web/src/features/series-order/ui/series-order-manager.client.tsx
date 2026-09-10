"use client";
import type { ReactNode } from "react";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LoaderCircle,
  GripVertical,
  ChevronDown,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { RefObject } from "react";

import { guideChapterRuns } from "@/shared/lib/guide-chapter-runs";
import { useAutosave } from "@/shared/lib/autosave/use-autosave";
import { cn } from "@/shared/lib/utils";
import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import { reorderSeries } from "../api/series-order.browser";
import type {
  CreateSeriesOrderMaterialSearchQueryOptions,
  GuideChapterPresentation,
  ReorderSeriesResult,
  SeriesOrderItemPresentation,
  SeriesOrderPresentation,
} from "../model/presentation";

import {
  GUIDE_CHAPTER_NAME_MAX,
  GUIDE_CHAPTER_SUMMARY_MAX,
} from "../model/presentation";

const STEP_GROUP_LIMIT = 120;
const UNASSIGNED = "unassigned";

export function SeriesOrderManager({
  embedded = false,
  homePin,
  createMaterialSearchQueryOptions,
  onBack,
  onRefresh,
  onSelectPlaylist,
  presentation,
}: {
  readonly embedded?: boolean;
  readonly homePin?: ReactNode;
  readonly createMaterialSearchQueryOptions: CreateSeriesOrderMaterialSearchQueryOptions;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onSelectPlaylist: (seriesId: string) => void;
  readonly presentation: SeriesOrderPresentation;
}) {
  const [chapters, setChapters] = useState(presentation.chapters);
  const [items, setItems] = useState(presentation.items);
  const version = useRef(presentation.orderVersion);
  const mutation = useMutation({ mutationFn: reorderSeries });
  const attempted = useRef<Parameters<typeof reorderSeries>[0] | null>(null);
  const autosave = useAutosave({
    value: composition(items, chapters),
    enabled:
      items.every(
        ({ stepGroup }) => (stepGroup?.trim().length ?? 0) <= STEP_GROUP_LIMIT,
      ) &&
      chapters.every(
        ({ name, summary }) =>
          name.trim().length > 0 &&
          name.trim().length <= GUIDE_CHAPTER_NAME_MAX &&
          summary.trim().length <= GUIDE_CHAPTER_SUMMARY_MAX,
      ),
    save: async (snapshot) => {
      const input = attempted.current ?? {
        chapters: snapshot.chapters,
        chapterAssignments: Object.fromEntries(
          snapshot.entries.flatMap(({ chapterId, materialId }) =>
            chapterId === null ? [] : [[materialId, chapterId]],
          ),
        ),
        expectedOrderVersion: version.current,
        orderedMaterialIds: snapshot.entries.map(({ materialId }) => materialId),
        stepGroups: Object.fromEntries(
          snapshot.entries.flatMap(({ materialId, stepGroup }) =>
            stepGroup === null ? [] : [[materialId, stepGroup]],
          ),
        ),
        seriesId: presentation.seriesId,
      };
      attempted.current = input;
      const next = await mutation.mutateAsync(input);
      if (next.kind !== "saved") return "failed";
      version.current = next.orderVersion;
      attempted.current = null;
      return "saved";
    },
  });
  const result = mutation.data ?? null;
  const pending = autosave.pending;
  const dirty = autosave.dirty;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const dragState = { draggedId, dropId, setDraggedId, setDropId };
  const [positionNotice, setPositionNotice] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDialogElement>(null);
  const close = () => {
    void autosave.flush().then((ok) => {
      if (ok) onBack();
    });
  };

  /** Positions move inside one chapter; the chapter itself is changed explicitly. */
  const move = (index: number, offset: -1 | 1) => {
    const item = items[index];
    const destination = index + offset;
    const neighbour = items[destination];
    if (
      item === undefined ||
      neighbour === undefined ||
      (neighbour.chapterId ?? null) !== (item.chapterId ?? null)
    )
      return;
    const next = [...items];
    next.splice(index, 1);
    next.splice(destination, 0, item);
    mutation.reset();
    setItems(next);
    setPositionNotice(
      `${item.title}: позиция ${String(destination + 1)} из ${String(next.length)}`,
    );
  };
  const placeBefore = (materialId: string, targetIndex: number) => {
    const target = items[targetIndex];
    const source = items.findIndex((entry) => entry.materialId === materialId);
    const entry = items[source];
    if (target === undefined || entry === undefined || source === targetIndex) return;
    const chapterId = target.chapterId ?? null;
    const next = [...items];
    next.splice(source, 1);
    next.splice(next.indexOf(target), 0, { ...entry, chapterId });
    mutation.reset();
    setItems(next);
    setPositionNotice(
      `${entry.title}: позиция ${String(next.indexOf(entry) + 1)} из ${String(next.length)}`,
    );
  };
  const assign = (materialId: string, chapterId: string | null) => {
    mutation.reset();
    setItems((current) => {
      const source = current.findIndex((entry) => entry.materialId === materialId);
      const entry = current[source];
      if (entry === undefined) return current;
      const rest = current.filter((_, index) => index !== source);
      const destination = chapterRunEnd(rest, chapters, chapterId);
      return [
        ...rest.slice(0, destination),
        { ...entry, chapterId },
        ...rest.slice(destination),
      ];
    });
  };
  const addChapter = () => {
    mutation.reset();
    setChapters((current) => [
      ...current,
      { id: crypto.randomUUID(), name: "Новая глава", summary: "" },
    ]);
  };
  const editChapter = (id: string, values: Partial<GuideChapterPresentation>) => {
    mutation.reset();
    setChapters((current) =>
      current.map((chapter) =>
        chapter.id === id ? { ...chapter, ...values } : chapter,
      ),
    );
  };
  const moveChapter = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    const chapter = chapters[index];
    if (chapter === undefined || destination < 0 || destination >= chapters.length)
      return;
    const other = chapters[destination];
    if (other === undefined) return;
    const next = [...chapters];
    next.splice(index, 1);
    next.splice(destination, 0, chapter);
    mutation.reset();
    setChapters(next);
    setItems((current) => exchangeRuns(current, chapter.id, other.id));
    setPositionNotice(
      `${chapter.name}: глава ${String(destination + 1)} из ${String(next.length)}`,
    );
  };
  const removeItem = (materialId: string) => {
    mutation.reset();
    setItems((current) =>
      current.filter((entry) => entry.materialId !== materialId),
    );
  };
  const setStepGroup = (materialId: string, stepGroup: string) => {
    mutation.reset();
    setItems((current) =>
      current.map((entry) =>
        entry.materialId === materialId ? { ...entry, stepGroup } : entry,
      ),
    );
  };
  const removeChapter = (id: string) => {
    const next = chapters.filter((chapter) => chapter.id !== id);
    mutation.reset();
    setChapters(next);
    setItems((current) =>
      current.map((entry) =>
        entry.chapterId === id ? { ...entry, chapterId: null } : entry,
      ),
    );
  };
  const actions: CompositionActions = {
    assign,
    editChapter,
    move,
    moveChapter,
    placeBefore,
    removeChapter,
    removeItem,
    setStepGroup,
  };
  const openPicker = () => {
    setPickerOpen(true);
    pickerRef.current?.showModal();
  };

  const Container = embedded ? "section" : "main";
  return (
    <Container
      className={
        embedded
          ? "text-foreground"
          : "h-full min-h-svh overflow-y-auto bg-background px-4 pb-20 pt-5 text-foreground sm:px-6 md:min-h-0"
      }
      id={embedded ? undefined : "authoring-content"}
      tabIndex={-1}
    >
      <div className={embedded ? "w-full" : "mx-auto w-full max-w-4xl"}>
        {embedded ? (
          <header className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-4">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold">Материалы руководства</h2>
              <span className="text-sm tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={presentation.archived}
                onClick={addChapter}
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" />
                Добавить главу
              </Button>
              <Button
                disabled={presentation.archived}
                onClick={openPicker}
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" />
                Добавить материал
              </Button>
            </div>
          </header>
        ) : (
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div className="flex min-w-0 items-start gap-3">
              <Button
                aria-label={
                  embedded ? "Закрыть состав руководства" : "Вернуться к материалам"
                }
                className="mt-0.5 size-10"
                onClick={close}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">
                  Порядок материалов
                </p>
                <h1 className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                  {presentation.name}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Порядок и состав сохраняются автоматически.
                </p>
              </div>
            </div>
            <div className="grid w-full gap-3 sm:w-72">
              {embedded ? null : (
                <div>
                  <label
                    className="mb-2 block text-sm font-medium"
                    htmlFor="playlist-switcher"
                  >
                    Руководство
                  </label>
                  <Select
                    onValueChange={(value) => {
                      onSelectPlaylist(value);
                    }}
                    value={presentation.seriesId}
                  >
                    <SelectTrigger
                      className="min-h-11 w-full rounded-xl bg-card"
                      id="playlist-switcher"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {presentation.options.map((option) => (
                        <SelectItem
                          disabled={
                            option.archived === true &&
                            option.value !== presentation.seriesId
                          }
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                          {option.archived === true ? " · архив" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  disabled={presentation.archived}
                  onClick={addChapter}
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Добавить главу
                </Button>
                <Button
                  disabled={presentation.archived}
                  onClick={openPicker}
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Добавить материал
                </Button>
              </div>
            </div>
          </header>
        )}
        {homePin}
        <p className="sr-only" role="status">
          {positionNotice}
        </p>

        <OrderFeedback
          dirty={dirty}
          onRefresh={onRefresh}
          result={result}
          seriesId={presentation.seriesId}
        />

        <MaterialPickerDialog
          createQueryOptions={createMaterialSearchQueryOptions}
          dialogRef={pickerRef}
          onAdd={(material) => {
            mutation.reset();
            setItems((current) =>
              current.some(
                ({ materialId }) => materialId === material.materialId,
              )
                ? current
                : [...current, { ...material, chapterId: null }],
            );
          }}
          onOpenChange={setPickerOpen}
          open={pickerOpen}
          selectedIds={new Set(items.map(({ materialId }) => materialId))}
        />

        <form
          className="mt-2"
          id="series-order-form"
          onSubmit={(event) => {
            event.preventDefault();
            void autosave.retry();
          }}
        >
          {presentation.archived ? (
            <div className="mb-7 rounded-2xl bg-muted p-5 text-sm leading-6">
              <p className="font-semibold">Руководство находится в архиве</p>
              <p className="mt-1 text-muted-foreground">
                Можно изменить порядок или удалить существующие материалы. Новые
                назначения станут доступны после восстановления руководства.
              </p>
            </div>
          ) : null}

          {items.length === 0 && chapters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-14 text-center">
              <h2 className="text-lg font-semibold">Руководство пока пусто</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Нажмите «Добавить материал» и найдите нужную запись.
              </p>
            </div>
          ) : (
            <div className="grid gap-8">
              {guideChapterRuns(items, chapters, ({ chapterId }) => chapterId ?? null).map(
                (section) => (
                  <ChapterSection
                    actions={actions}
                    archived={presentation.archived}
                    chapter={section.chapter}
                    chapters={chapters}
                    dragState={dragState}
                    entries={section.items.map((item, index) => ({
                      item,
                      position: section.offset + index,
                    }))}
                    grouped={chapters.length > 0}
                    key={section.chapter?.id ?? `open-${String(section.offset)}`}
                    number={
                      section.chapter === null
                        ? null
                        : chapters.indexOf(section.chapter) + 1
                    }
                    total={items.length}
                  />
                ),
              )}
            </div>
          )}

          <div className="mt-6 flex justify-end border-t border-border pt-5">
            <span role="status" className="text-xs text-muted-foreground">
              {pending ? "Сохранение…" : dirty ? "Не сохранено" : "Сохранено"}
            </span>
            {autosave.error ? (
              <Button
                onClick={() => {
                  void autosave.retry();
                }}
                type="button"
                variant="outline"
              >
                Повторить сохранение
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </Container>
  );
}

function OrderFeedback({
  dirty,
  onRefresh,
  result,
  seriesId,
}: {
  readonly dirty: boolean;
  readonly onRefresh: () => void;
  readonly result: ReorderSeriesResult | null;
  readonly seriesId: string;
}) {
  const message = actionMessage(result, dirty);
  if (message === null) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p aria-live="polite" className="text-muted-foreground">
        {message}
      </p>
      {result?.kind === "conflict" ? (
        <Button onClick={onRefresh} size="sm" type="button" variant="outline">
          Обновить список
        </Button>
      ) : result?.kind === "unauthorized" ? (
        <form action="/auth/sign-in" method="post">
          <input
            name="returnTo"
            type="hidden"
            value={`/authoring/guides/${seriesId}`}
          />
          <Button size="sm" type="submit">
            Войти
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function MaterialPickerDialog({
  createQueryOptions,
  dialogRef,
  onAdd,
  onOpenChange,
  open,
  selectedIds,
}: {
  readonly createQueryOptions: CreateSeriesOrderMaterialSearchQueryOptions;
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  readonly onAdd: (material: SeriesOrderItemPresentation) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly selectedIds: ReadonlySet<string>;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useLiveSearchValue(search)
    .trim()
    .replace(/\s+/gu, " ");

  const materials = useQuery({
    ...createQueryOptions({ page, search: debouncedSearch }),
    enabled: open,
  });
  const result = materials.data;
  const candidates =
    result?.kind === "ready"
      ? result.items.filter(({ materialId }) => !selectedIds.has(materialId))
      : [];
  const close = () => {
    dialogRef.current?.close();
  };

  return (
    <dialog
      aria-labelledby="material-picker-heading"
      className="m-auto max-h-[min(44rem,calc(100svh-2rem))] w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/35"
      onClose={() => {
        setSearch("");
        setPage(1);
        onOpenChange(false);
      }}
      ref={dialogRef}
    >
      <div className="flex max-h-[min(44rem,calc(100svh-2rem))] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2
              className="text-xl font-semibold tracking-[-0.025em]"
              id="material-picker-heading"
            >
              Добавить материал
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Выберите материал или найдите по названию.
            </p>
          </div>
          <Button
            aria-label="Закрыть выбор материала"
            onClick={close}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="p-5">
          <label className="relative block">
            <span className="sr-only">Поиск материала для добавления</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              autoComplete="off"
              autoFocus
              className="min-h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              maxLength={160}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setPage(1);
              }}
              placeholder="Название материала"
              type="search"
              value={search}
            />
          </label>
        </div>

        <div
          aria-busy={materials.isFetching}
          className="min-h-48 flex-1 overflow-y-auto border-t border-border px-5 py-4"
        >
          {materials.isPending ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
              Ищем материалы…
            </p>
          ) : result?.kind === "unauthorized" ? (
            <p className="py-12 text-center text-sm text-destructive">
              Сессия завершилась. Закройте окно и войдите снова.
            </p>
          ) : result?.kind === "error" || materials.isError ? (
            <div className="py-10 text-center text-sm">
              <p className="text-destructive">Не удалось выполнить поиск.</p>
              <Button
                className="mt-3"
                onClick={() => {
                  void materials.refetch();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Повторить
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Подходящих материалов на этой странице нет.
            </p>
          ) : (
            <ul
              aria-label="Результаты поиска материалов"
              className="grid gap-2"
              role="list"
            >
              {candidates.map((material) => (
                <li
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                  key={material.materialId}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {material.title}
                    </span>
                    <span className="mt-1 block font-mono text-[0.6875rem] text-muted-foreground">
                      {stateLabel(material.publicationState)}
                    </span>
                  </span>
                  <Button
                    aria-label={`Добавить «${material.title}»`}
                    onClick={() => {
                      onAdd(material);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus aria-hidden="true" />
                    Добавить
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {result?.kind === "ready" && result.totalPages > 1 ? (
          <nav
            aria-label="Страницы результатов поиска"
            className="flex items-center justify-between gap-3 border-t border-border p-4"
          >
            <Button
              disabled={result.page <= 1 || materials.isFetching}
              onClick={() => {
                setPage(result.page - 1);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <ArrowLeft aria-hidden="true" />
              Назад
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              {result.page} из {result.totalPages}
            </span>
            <Button
              disabled={
                result.page >= result.totalPages || materials.isFetching
              }
              onClick={() => {
                setPage(result.page + 1);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Далее
              <ArrowRight aria-hidden="true" />
            </Button>
          </nav>
        ) : null}
      </div>
    </dialog>
  );
}

function actionMessage(
  result: ReorderSeriesResult | null,
  dirty: boolean,
): string | null {
  if (result?.kind === "conflict") {
    return "Состав или порядок изменился в другой вкладке.";
  }
  if (result?.kind === "unauthorized") {
    return "Сессия завершилась. Войдите снова, чтобы продолжить.";
  }
  if (result?.kind === "error") {
    return `Не удалось сохранить. Код обращения: ${result.reference}`;
  }
  if (dirty) return "Есть несохранённые изменения.";
  if (result?.kind === "saved") return "Порядок сохранён.";
  return null;
}

function stateLabel(
  state: SeriesOrderItemPresentation["publicationState"],
): string {
  if (state === "published") return "Опубликован";
  if (state === "unpublished") return "Снят с публикации";
  return "Черновик";
}

interface DragState {
  readonly draggedId: string | null;
  readonly dropId: string | null;
  readonly setDraggedId: (materialId: string | null) => void;
  readonly setDropId: (materialId: string | null) => void;
}

interface CompositionActions {
  readonly assign: (materialId: string, chapterId: string | null) => void;
  readonly editChapter: (id: string, values: Partial<GuideChapterPresentation>) => void;
  readonly move: (position: number, offset: -1 | 1) => void;
  readonly moveChapter: (index: number, offset: -1 | 1) => void;
  readonly placeBefore: (materialId: string, targetPosition: number) => void;
  readonly removeChapter: (id: string) => void;
  readonly removeItem: (materialId: string) => void;
  readonly setStepGroup: (materialId: string, stepGroup: string) => void;
}

interface ChapterSectionProps {
  readonly actions: CompositionActions;
  readonly archived: boolean;
  readonly chapter: GuideChapterPresentation | null;
  readonly chapters: readonly GuideChapterPresentation[];
  readonly dragState: DragState;
  readonly entries: readonly {
    readonly item: SeriesOrderItemPresentation;
    readonly position: number;
  }[];
  readonly grouped: boolean;
  readonly number: number | null;
  readonly total: number;
}

/** One chapter of the main path, or the Materials the author has not grouped yet. */
function ChapterSection({
  actions,
  archived,
  chapter,
  chapters,
  dragState,
  entries,
  grouped,
  number,
  total,
}: ChapterSectionProps) {
  const index = (number ?? 1) - 1;
  if (chapter === null && !grouped) {
    return (
      <MaterialList
        actions={actions}
        archived={archived}
        chapters={chapters}
        dragState={dragState}
        entries={entries}
        label="Материалы руководства"
        total={total}
      />
    );
  }
  const headingId = `chapter-${chapter?.id ?? `open-${String(entries[0]?.position ?? 0)}`}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      {chapter === null ? (
        <h2 className="border-b border-border pb-2 text-sm font-semibold text-muted-foreground" id={headingId}>
          Вне глав
        </h2>
      ) : (
        <div className="border-b border-border pb-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-3 w-6 shrink-0 text-center text-sm tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <label className="min-w-0 flex-1">
              <span className="sr-only" id={headingId}>
                Глава {index + 1}: {chapter.name}
              </span>
              <input
                aria-label={`Название главы ${String(index + 1)}`}
                className="block min-h-11 w-full rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold outline-none hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                maxLength={GUIDE_CHAPTER_NAME_MAX}
                name={`chapter-name-${chapter.id}`}
                onChange={(event) => {
                  actions.editChapter(chapter.id, { name: event.currentTarget.value });
                }}
                placeholder="Название главы"
                required
                value={chapter.name}
              />
            </label>
            <div className="flex shrink-0 gap-0.5">
              <Button
                aria-label={`Поднять главу «${chapter.name}»`}
                className="size-10"
                disabled={index === 0}
                onClick={() => {
                  actions.moveChapter(index, -1);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                aria-label={`Опустить главу «${chapter.name}»`}
                className="size-10"
                disabled={index === chapters.length - 1}
                onClick={() => {
                  actions.moveChapter(index, 1);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                aria-label={`Удалить главу «${chapter.name}»`}
                className="size-10"
                onClick={() => {
                  actions.removeChapter(chapter.id);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
          <details className="mt-1 min-w-0 px-2 text-sm">
            <summary className="flex min-h-9 w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
              <span>
                {chapter.summary.trim() ? "Описание главы" : "Добавить описание главы"}
              </span>
            </summary>
            <label className="mt-2 block pb-2 text-xs text-muted-foreground">
              Зачем эта глава, что читатель в ней сделает и какой получит результат
              <textarea
                className="mt-1 block min-h-28 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-6 text-foreground focus-visible:outline-ring"
                maxLength={GUIDE_CHAPTER_SUMMARY_MAX}
                name={`chapter-summary-${chapter.id}`}
                onChange={(event) => {
                  actions.editChapter(chapter.id, { summary: event.currentTarget.value });
                }}
                placeholder="Несколько абзацев для читателя"
                value={chapter.summary}
              />
            </label>
          </details>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="px-2 py-5 text-sm text-muted-foreground">
          Глава пока пустая. Перенесите в неё материал из списка ниже.
        </p>
      ) : (
        <MaterialList
          actions={actions}
          archived={archived}
          chapters={chapters}
          dragState={dragState}
          entries={entries}
          label={chapter === null ? "Материалы вне глав" : `Материалы главы «${chapter.name}»`}
          total={total}
        />
      )}
    </section>
  );
}

function MaterialList({
  actions,
  archived,
  chapters,
  dragState,
  entries,
  label,
  total,
}: {
  readonly actions: CompositionActions;
  readonly archived: boolean;
  readonly chapters: readonly GuideChapterPresentation[];
  readonly dragState: DragState;
  readonly entries: readonly {
    readonly item: SeriesOrderItemPresentation;
    readonly position: number;
  }[];
  readonly label: string;
  readonly total: number;
}) {
  return (
    <ol aria-label={label} className="divide-y divide-border">
      {entries.map(({ item, position }, index) => (
        <MaterialRow
          actions={actions}
          archived={archived}
          chapters={chapters}
          dragState={dragState}
          first={index === 0}
          item={item}
          key={item.materialId}
          last={index === entries.length - 1}
          position={position}
          total={total}
        />
      ))}
    </ol>
  );
}

function MaterialRow({
  actions,
  archived,
  chapters,
  dragState,
  first,
  item,
  last,
  position,
  total,
}: {
  readonly actions: CompositionActions;
  readonly archived: boolean;
  readonly chapters: readonly GuideChapterPresentation[];
  readonly dragState: DragState;
  readonly first: boolean;
  readonly item: SeriesOrderItemPresentation;
  readonly last: boolean;
  readonly position: number;
  readonly total: number;
}) {
  const { draggedId, dropId, setDraggedId, setDropId } = dragState;
  return (
    <li
      className={cn(
        "group relative min-w-0 py-4",
        draggedId === item.materialId && "opacity-50",
        dropId === item.materialId && "bg-secondary outline-2 outline-ring",
      )}
      onDragOver={(event) => {
        if (draggedId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropId(item.materialId);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropId(null);
      }}
      onDrop={(event) => {
        if (draggedId === null) return;
        event.preventDefault();
        actions.placeBefore(draggedId, position);
        setDraggedId(null);
        setDropId(null);
      }}
    >
      <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 sm:grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_auto] sm:gap-x-3">
        <span className="col-start-1 row-start-1 w-6 self-start pt-1.5 text-center text-sm tabular-nums text-muted-foreground">
          {position + 1}
        </span>
        <button
          aria-label={`Переместить «${item.title}»`}
          title="Перетащите или используйте клавиши ↑ и ↓"
          className="col-start-2 row-start-1 hidden size-10 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing sm:flex"
          draggable
          type="button"
          onDragStart={(event) => {
            setDraggedId(item.materialId);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.materialId);
          }}
          onDragEnd={() => {
            setDraggedId(null);
            setDropId(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              actions.move(position, event.key === "ArrowUp" ? -1 : 1);
            }
          }}
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <div className="contents">
          <p className="col-span-2 col-start-2 row-start-1 min-w-0 pt-1.5 sm:col-span-1 sm:col-start-3 font-medium leading-snug [overflow-wrap:anywhere]">
            {item.title}
          </p>
          <span
            className={cn(
              "col-start-2 row-start-2 min-w-0 text-xs sm:col-start-3",
              item.publicationState === "published"
                ? "text-muted-foreground"
                : "font-medium text-action",
            )}
          >
            {stateLabel(item.publicationState)}
          </span>
          <details className="col-span-2 col-start-2 row-start-3 min-w-0 text-sm sm:col-span-1 sm:col-start-3">
            <summary className="flex min-h-9 w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="[overflow-wrap:anywhere]">
                {item.stepGroup?.trim()
                  ? item.stepGroup.trim()
                  : "Последовательность шагов"}
              </span>
            </summary>
            <div className="mt-2 grid max-w-sm gap-3 pb-2">
              <label className="block text-xs text-muted-foreground">
                Название последовательности
                <input
                  name={`step-group-${item.materialId}`}
                  className="mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-ring"
                  maxLength={STEP_GROUP_LIMIT}
                  onChange={(event) => {
                    actions.setStepGroup(item.materialId, event.currentTarget.value);
                  }}
                  placeholder="Без последовательности"
                  value={item.stepGroup ?? ""}
                />
              </label>
              {chapters.length === 0 ? null : (
                <label className="block text-xs text-muted-foreground">
                  Глава
                  <select
                    className="mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-ring"
                    disabled={archived}
                    name={`chapter-of-${item.materialId}`}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      actions.assign(item.materialId, value === UNASSIGNED ? null : value);
                    }}
                    value={item.chapterId ?? UNASSIGNED}
                  >
                    <option value={UNASSIGNED}>Вне глав</option>
                    {chapters.map((chapter, chapterIndex) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapterIndex + 1}. {chapter.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
        </div>
        <div className="col-start-3 row-start-2 flex shrink-0 justify-end gap-0.5 sm:col-start-4 sm:row-span-3 sm:row-start-1 sm:self-start">
          <Button
            aria-label={`Поднять «${item.title}»`}
            className="size-10"
            disabled={first}
            onClick={() => {
              actions.move(position, -1);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            aria-label={`Опустить «${item.title}»`}
            className="size-10"
            disabled={last}
            onClick={() => {
              actions.move(position, 1);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            aria-label={`Убрать «${item.title}»`}
            className="size-10"
            onClick={() => {
              actions.removeItem(item.materialId);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
      <span className="sr-only">
        Позиция {position + 1} из {total}
      </span>
    </li>
  );
}

/**
 * A chapter owns one continuous run of the main path, so a Material joins the end of its run.
 * A chapter that holds nothing yet starts right after the last preceding chapter that does.
 */
function chapterRunEnd(
  items: readonly SeriesOrderItemPresentation[],
  chapters: readonly GuideChapterPresentation[],
  chapterId: string | null,
): number {
  if (chapterId === null) return items.length;
  const last = items.findLastIndex((entry) => (entry.chapterId ?? null) === chapterId);
  if (last >= 0) return last + 1;
  const preceding = new Set(
    chapters.slice(0, chapters.findIndex(({ id }) => id === chapterId)).map(({ id }) => id),
  );
  return items.findLastIndex((entry) => preceding.has(entry.chapterId ?? "")) + 1;
}

/** Exchange two chapter runs in place, leaving every other Material where the author put it. */
function exchangeRuns(
  items: readonly SeriesOrderItemPresentation[],
  first: string,
  second: string,
): readonly SeriesOrderItemPresentation[] {
  const run = (chapterId: string) => {
    const start = items.findIndex((entry) => entry.chapterId === chapterId);
    return start < 0
      ? null
      : { start, end: items.findLastIndex((entry) => entry.chapterId === chapterId) + 1 };
  };
  const left = run(first);
  const right = run(second);
  if (left === null || right === null) return items;
  const [earlier, later] = left.start < right.start ? [left, right] : [right, left];
  return [
    ...items.slice(0, earlier.start),
    ...items.slice(later.start, later.end),
    ...items.slice(earlier.end, later.start),
    ...items.slice(earlier.start, earlier.end),
    ...items.slice(later.end),
  ];
}

/** The saved shape of the whole composition; autosave compares it and sends it unchanged. */
function composition(
  items: readonly SeriesOrderItemPresentation[],
  chapters: readonly GuideChapterPresentation[],
): {
  readonly chapters: readonly GuideChapterPresentation[];
  readonly entries: readonly {
    readonly chapterId: string | null;
    readonly materialId: string;
    readonly stepGroup: string | null;
  }[];
} {
  return {
    chapters: chapters.map(({ id, name, summary }) => ({
      id,
      name: name.trim(),
      summary: summary.trim(),
    })),
    entries: items.map(({ chapterId, materialId, stepGroup }) => ({
      chapterId: chapterId ?? null,
      materialId,
      stepGroup: stepGroup?.trim() ? stepGroup.trim() : null,
    })),
  };
}
