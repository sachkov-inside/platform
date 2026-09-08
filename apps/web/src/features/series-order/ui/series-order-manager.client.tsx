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
  X,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { RefObject } from "react";

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
  ReorderSeriesResult,
  SeriesOrderItemPresentation,
  SeriesOrderPresentation,
} from "../model/presentation";

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
  const [items, setItems] = useState(presentation.items);
  const version = useRef(presentation.orderVersion);
  const mutation = useMutation({ mutationFn: reorderSeries });
  const attempted = useRef<Parameters<typeof reorderSeries>[0] | null>(null);
  const autosave = useAutosave({
    value: compositionEntries(items),
    enabled: items.every(
      ({ stepGroup }) => (stepGroup?.trim().length ?? 0) <= 120,
    ),
    save: async (entries) => {
      const input = attempted.current ?? {
        expectedOrderVersion: version.current,
        orderedMaterialIds: entries.map(([id]) => id),
        stepGroups: Object.fromEntries(
          entries.flatMap(([id, group]) => (group ? [[id, group]] : [])),
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
  const [positionNotice, setPositionNotice] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDialogElement>(null);
  const close = () => {
    void autosave.flush().then((ok) => {
      if (ok) onBack();
    });
  };

  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(destination, 0, item);
    mutation.reset();
    setItems(next);
    setPositionNotice(
      `${item.title}: позиция ${String(destination + 1)} из ${String(next.length)}`,
    );
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
              <h2 className="text-xl font-semibold">Материалы серии</h2>
              <span className="text-sm tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </div>
            <Button
              disabled={presentation.archived}
              onClick={openPicker}
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" />
              Добавить материал
            </Button>
          </header>
        ) : (
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div className="flex min-w-0 items-start gap-3">
              <Button
                aria-label={
                  embedded ? "Закрыть состав серии" : "Вернуться к материалам"
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
                    Серия
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
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
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
                : [...current, material],
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
              <p className="font-semibold">Серия находится в архиве</p>
              <p className="mt-1 text-muted-foreground">
                Можно изменить порядок или удалить существующие материалы. Новые
                назначения станут доступны после восстановления серии.
              </p>
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-14 text-center">
              <h2 className="text-lg font-semibold">Серия пока пуста</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Нажмите «Добавить материал» и найдите нужную запись.
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border" aria-label="Материалы серии">
              {items.map((item, index) => (
                <li
                  className={cn(
                    "group relative min-w-0 py-4",
                    draggedId === item.materialId && "opacity-50",
                    dropId === item.materialId &&
                      "bg-secondary outline-2 outline-ring",
                  )}
                  key={item.materialId}
                  onDragOver={(event) => {
                    if (draggedId === null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropId(item.materialId);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    )
                      setDropId(null);
                  }}
                  onDrop={(event) => {
                    if (draggedId === null) return;
                    event.preventDefault();
                    const source = items.findIndex(
                      ({ materialId }) => materialId === draggedId,
                    );
                    const next = [...items];
                    const [entry] = next.splice(source, 1);
                    if (source >= 0 && entry !== undefined) {
                      next.splice(index, 0, entry);
                      mutation.reset();
                      setItems(next);
                      setPositionNotice(
                        `${entry.title}: позиция ${String(index + 1)} из ${String(next.length)}`,
                      );
                    }
                    setDraggedId(null);
                    setDropId(null);
                  }}
                >
                  <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 sm:grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_auto] sm:gap-x-3">
                    <span className="col-start-1 row-start-1 w-6 self-start pt-1.5 text-center text-sm tabular-nums text-muted-foreground">
                      {index + 1}
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
                        event.dataTransfer.setData(
                          "text/plain",
                          item.materialId,
                        );
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDropId(null);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowUp" ||
                          event.key === "ArrowDown"
                        ) {
                          event.preventDefault();
                          move(index, event.key === "ArrowUp" ? -1 : 1);
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
                          <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 shrink-0"
                          />
                          <span className="[overflow-wrap:anywhere]">
                            {item.stepGroup?.trim()
                              ? item.stepGroup.trim()
                              : "Последовательность шагов"}
                          </span>
                        </summary>
                        <label className="mt-2 block max-w-sm pb-2 text-xs text-muted-foreground">
                          Название последовательности
                          <input
                            name={`step-group-${item.materialId}`}
                            className="mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-ring"
                            maxLength={120}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              mutation.reset();
                              setItems((current) =>
                                current.map((entry) =>
                                  entry.materialId === item.materialId
                                    ? { ...entry, stepGroup: value }
                                    : entry,
                                ),
                              );
                            }}
                            placeholder="Без последовательности"
                            value={item.stepGroup ?? ""}
                          />
                        </label>
                      </details>
                    </div>
                    <div className="col-start-3 row-start-2 flex shrink-0 justify-end gap-0.5 sm:col-start-4 sm:row-span-3 sm:row-start-1 sm:self-start">
                      <Button
                        aria-label={`Поднять «${item.title}»`}
                        className="size-10"
                        disabled={index === 0}
                        onClick={() => {
                          move(index, -1);
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
                        disabled={index === items.length - 1}
                        onClick={() => {
                          move(index, 1);
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
                          mutation.reset();
                          setItems((current) =>
                            current.filter(
                              ({ materialId }) =>
                                materialId !== item.materialId,
                            ),
                          );
                        }}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
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
            value={`/authoring/playlists/${seriesId}`}
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

function compositionEntries(
  items: readonly SeriesOrderItemPresentation[],
): readonly (readonly [string, string | null])[] {
  return items.map(({ materialId, stepGroup }) => [
    materialId,
    stepGroup?.trim() ? stepGroup.trim() : null,
  ]);
}
