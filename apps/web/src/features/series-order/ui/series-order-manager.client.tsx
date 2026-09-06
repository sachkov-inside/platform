"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  LoaderCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { RefObject } from "react";

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
  createMaterialSearchQueryOptions,
  onBack,
  onRefresh,
  onSelectPlaylist,
  presentation,
}: {
  readonly createMaterialSearchQueryOptions: CreateSeriesOrderMaterialSearchQueryOptions;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onSelectPlaylist: (seriesId: string) => void;
  readonly presentation: SeriesOrderPresentation;
}) {
  const [items, setItems] = useState(presentation.items);
  const [baseline, setBaseline] = useState(() => ({
    ids: presentation.items.map(({ materialId }) => materialId),
    orderVersion: presentation.orderVersion,
  }));
  const mutation = useMutation({
    mutationFn: reorderSeries,
    onSuccess: (next, submitted) => {
      if (next.kind !== "saved") return;
      setBaseline({
        ids: [...submitted.orderedMaterialIds],
        orderVersion: next.orderVersion,
      });
    },
  });
  const result = mutation.data ?? null;
  const pending = mutation.isPending;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDialogElement>(null);
  const dirty =
    items.length !== baseline.ids.length ||
    items.some(({ materialId }, index) => materialId !== baseline.ids[index]);
  const expectedOrderVersion = baseline.orderVersion;
  const canSave =
    dirty &&
    !pending &&
    result?.kind !== "conflict" &&
    result?.kind !== "unauthorized";

  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(destination, 0, item);
    mutation.reset();
    setItems(next);
  };
  const openPicker = () => {
    setPickerOpen(true);
    pickerRef.current?.showModal();
  };

  return (
    <main
      className="h-full min-h-svh overflow-y-auto bg-background px-4 pb-20 pt-5 text-foreground sm:px-6 md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              aria-label="Вернуться к материалам"
              className="mt-0.5 size-10"
              onClick={onBack}
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
                Перемещайте материалы кнопками. Изменения появятся в публичном
                серии после сохранения.
              </p>
            </div>
          </div>
          <div className="grid w-full gap-3 sm:w-72">
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
              <SaveOrderButton canSave={canSave} pending={pending} />
            </div>
          </div>
        </header>

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
              current.some(({ materialId }) => materialId === material.materialId)
                ? current
                : [...current, material],
            );
          }}
          onOpenChange={setPickerOpen}
          open={pickerOpen}
          selectedIds={new Set(items.map(({ materialId }) => materialId))}
        />

        <form
          className="mt-6"
          id="series-order-form"
          onSubmit={(event) => {
            event.preventDefault();
            const orderedMaterialIds = items.map(({ materialId }) => materialId);
            mutation.mutate({
              expectedOrderVersion,
              orderedMaterialIds,
              seriesId: presentation.seriesId,
            });
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
            <ol className="grid gap-2" aria-label="Материалы серии">
              {items.map((item, index) => (
                <li
                  className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4"
                  key={item.materialId}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title}</p>
                    <span
                      className={cn(
                        "mt-1 inline-flex rounded-full px-2 py-0.5 font-mono text-[0.6875rem]",
                        stateClassName(item.publicationState),
                      )}
                    >
                      {stateLabel(item.publicationState)}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      aria-label={`Поднять «${item.title}»`}
                      disabled={pending || index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Опустить «${item.title}»`}
                      disabled={pending || index === items.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Убрать «${item.title}»`}
                      disabled={pending}
                      onClick={() => {
                        mutation.reset();
                        setItems((current) =>
                          current.filter(
                            ({ materialId }) => materialId !== item.materialId,
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
                </li>
              ))}
            </ol>
          )}

          <div className="mt-6 flex justify-end border-t border-border pt-5">
            <SaveOrderButton canSave={canSave} pending={pending} />
          </div>
        </form>
      </div>
    </main>
  );
}

function SaveOrderButton({
  canSave,
  pending,
}: {
  readonly canSave: boolean;
  readonly pending: boolean;
}) {
  return (
    <Button disabled={!canSave} form="series-order-form" type="submit">
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin"
          data-icon="inline-start"
        />
      ) : (
        <Check aria-hidden="true" data-icon="inline-start" />
      )}
      {pending ? "Сохранение…" : "Сохранить"}
    </Button>
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
  const searchReady = search.trim().length >= 2 && debouncedSearch.length >= 2;
  const materials = useQuery({
    ...createQueryOptions({ page, search: debouncedSearch }),
    enabled: open && searchReady,
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
              Введите хотя бы два символа названия.
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
          {!searchReady ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Результаты появятся после ввода запроса.
            </p>
          ) : materials.isPending ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
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
              disabled={result.page >= result.totalPages || materials.isFetching}
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

function stateClassName(
  state: SeriesOrderItemPresentation["publicationState"],
): string {
  return state === "published"
    ? "bg-secondary text-foreground"
    : "bg-muted text-muted-foreground";
}
