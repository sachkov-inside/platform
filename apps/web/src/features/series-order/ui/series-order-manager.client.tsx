"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Check, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

import type {
  ReorderSeriesResult,
  SeriesOrderPresentation,
} from "../model/presentation";
import { reorderSeries } from "../api/series-order.browser";

export function SeriesOrderManager({
  onBack,
  onRefresh,
  onSelectPlaylist,
  presentation,
}: {
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onSelectPlaylist: (seriesId: string) => void;
  readonly presentation: SeriesOrderPresentation;
}) {
  const mutation = useMutation({ mutationFn: reorderSeries });
  const result = mutation.data ?? null;
  const pending = mutation.isPending;
  const [items, setItems] = useState(presentation.items);
  const [search, setSearch] = useState("");
  const [submittedOrder, setSubmittedOrder] = useState<readonly string[] | null>(null);
  const baselineIds =
    result?.kind === "saved" && submittedOrder !== null
      ? submittedOrder
      : presentation.items.map(({ materialId }) => materialId);
  const dirty =
    items.length !== baselineIds.length ||
    items.some(({ materialId }, index) => materialId !== baselineIds[index]);
  const expectedOrderVersion =
    result?.kind === "saved" ? result.orderVersion : presentation.orderVersion;
  const selectedIds = new Set(items.map(({ materialId }) => materialId));
  const normalizedSearch = search.trim().toLocaleLowerCase("ru");
  const candidates = presentation.availableMaterials
    .filter(
      (material) =>
        !selectedIds.has(material.materialId) &&
        (normalizedSearch.length === 0 ||
          material.title.toLocaleLowerCase("ru").includes(normalizedSearch)),
    )
    .slice(0, 50);

  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(destination, 0, item);
    setItems(next);
  };

  return (
    <>
      <main className="h-full min-h-svh overflow-y-auto bg-background px-4 pb-20 pt-5 text-foreground sm:px-6 md:min-h-0" id="authoring-content" tabIndex={-1}>
        <div className="mx-auto w-full max-w-4xl">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div className="flex min-w-0 items-start gap-3">
              <Button aria-label="Вернуться к материалам" className="mt-0.5 size-10" onClick={onBack} size="icon" type="button" variant="ghost">
                <ArrowLeft aria-hidden="true" />
              </Button>
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">Порядок материалов</p>
                <h1 className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{presentation.name}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Перемещайте материалы кнопками. Изменения появятся в публичном плейлисте после сохранения.
                </p>
              </div>
            </div>
            <div className="w-full sm:w-64">
              <label className="mb-2 block text-sm font-medium" htmlFor="playlist-switcher">Плейлист</label>
              <Select onValueChange={(value) => { onSelectPlaylist(value); }} value={presentation.seriesId}>
                <SelectTrigger className="min-h-11 w-full rounded-xl bg-card" id="playlist-switcher"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presentation.options.map((option) => <SelectItem disabled={option.archived === true && option.value !== presentation.seriesId} key={option.value} value={option.value}>{option.label}{option.archived === true ? " · архив" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </header>

          <form
            className="mt-6"
            id="series-order-form"
            onSubmit={(event) => {
              event.preventDefault();
              const orderedMaterialIds = items.map(({ materialId }) => materialId);
              setSubmittedOrder(orderedMaterialIds);
              mutation.mutate({
                expectedOrderVersion,
                orderedMaterialIds,
                seriesId: presentation.seriesId,
              });
            }}
          >
            <section aria-labelledby="add-material-heading" className="mb-7 rounded-2xl bg-card p-5 shadow-card">
              <h2 className="text-lg font-semibold" id="add-material-heading">Добавить материал</h2>
              <label className="relative mt-3 block">
                <span className="sr-only">Найти материал</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="min-h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                  onChange={(event) => { setSearch(event.currentTarget.value); }}
                  placeholder="Поиск по названию"
                  type="search"
                  value={search}
                />
              </label>
              {candidates.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Подходящих материалов нет.</p>
              ) : (
                <ul className="mt-3 grid max-h-64 gap-2 overflow-y-auto" role="list">
                  {candidates.map((material) => (
                    <li className="flex items-center gap-3 rounded-xl border border-border p-3" key={material.materialId}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{material.title}</span>
                        <span className="mt-1 block font-mono text-[0.6875rem] text-muted-foreground">{stateLabel(material.publicationState)}</span>
                      </span>
                      <Button aria-label={`Добавить «${material.title}»`} disabled={pending} onClick={() => { setItems((current) => [...current, material]); }} size="sm" type="button" variant="outline">
                        <Plus aria-hidden="true" />
                        Добавить
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-14 text-center">
                <h2 className="text-lg font-semibold">Плейлист пока пуст</h2>
                <p className="mt-2 text-sm text-muted-foreground">Найдите и добавьте материалы выше.</p>
              </div>
            ) : (
              <ol className="grid gap-2" aria-label="Материалы плейлиста">
                {items.map((item, index) => (
                  <li className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4" key={item.materialId}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.title}</p>
                      <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 font-mono text-[0.6875rem]", stateClassName(item.publicationState))}>
                        {stateLabel(item.publicationState)}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button aria-label={`Поднять «${item.title}»`} disabled={pending || index === 0} onClick={() => { move(index, -1); }} size="icon" type="button" variant="outline"><ArrowUp aria-hidden="true" /></Button>
                      <Button aria-label={`Опустить «${item.title}»`} disabled={pending || index === items.length - 1} onClick={() => { move(index, 1); }} size="icon" type="button" variant="outline"><ArrowDown aria-hidden="true" /></Button>
                      <Button aria-label={`Убрать «${item.title}»`} disabled={pending} onClick={() => { setItems((current) => current.filter(({ materialId }) => materialId !== item.materialId)); }} size="icon" type="button" variant="ghost"><X aria-hidden="true" /></Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

          </form>

          <div className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-card backdrop-blur-sm">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {actionMessage(result, dirty)}
            </p>
            {result?.kind === "conflict" ? (
              <Button onClick={onRefresh} type="button" variant="outline">Обновить список</Button>
            ) : result?.kind === "unauthorized" ? (
              <form action="/auth/sign-in" method="post">
                <input
                  name="returnTo"
                  type="hidden"
                  value={`/authoring/playlists/${presentation.seriesId}`}
                />
                <Button type="submit">Войти</Button>
              </form>
            ) : result?.kind === "error" ? (
              <Button form="series-order-form" type="submit" variant="outline">
                Повторить сохранение
              </Button>
            ) : (
              <Button disabled={!dirty || pending} form="series-order-form" type="submit">
                {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="inline-start" /> : <Check aria-hidden="true" data-icon="inline-start" />}
                {pending ? "Сохранение…" : "Сохранить порядок"}
              </Button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function actionMessage(result: ReorderSeriesResult | null, dirty: boolean): string {
  if (result?.kind === "saved") return "Порядок сохранён.";
  if (result?.kind === "conflict") {
    return "Состав или порядок изменился в другой вкладке.";
  }
  if (result?.kind === "unauthorized") {
    return "Сессия завершилась. Войдите снова, чтобы продолжить.";
  }
  if (result?.kind === "error") {
    return `Не удалось сохранить. Код обращения: ${result.reference}`;
  }
  return dirty ? "Есть несохранённые изменения." : "Порядок не изменён.";
}

function stateLabel(state: SeriesOrderPresentation["items"][number]["publicationState"]): string {
  if (state === "published") return "Опубликован";
  if (state === "unpublished") return "Снят с публикации";
  return "Черновик";
}

function stateClassName(state: SeriesOrderPresentation["items"][number]["publicationState"]): string {
  return state === "published" ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground";
}
