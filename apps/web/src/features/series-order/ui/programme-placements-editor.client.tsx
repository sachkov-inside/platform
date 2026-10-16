"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { seriesOrderQueryOptions } from "../api/read-series-order.browser";
import { reorderSeries } from "../api/series-order.browser";
import type {
  ProgrammePlacementPresentation,
  SeriesOrderPresentation,
} from "../model/presentation";

/** A fresh composition prevents the catalogue editor's autosave version from becoming a stale programme write. */
export function ProgrammePlacementsEditor({
  productId,
  onClose,
}: {
  readonly productId: string;
  readonly onClose: () => void;
}) {
  const query = useQuery({
    ...seriesOrderQueryOptions(productId),
    queryKey: ["series-order", productId, "programme-editor"],
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  return (
    <section className="grid gap-4 p-4">
      <Button type="button" variant="ghost" onClick={onClose}>
        К материалам продукта
      </Button>
      <h2 className="text-xl font-semibold">Размещения в программе</h2>
      <p className="text-sm text-muted-foreground">
        Один материал можно добавить несколько раз. Текст и отметка изучения
        останутся общими. Удаление размещения сохраняет материал в каталоге.
      </p>
      {query.isPending ? (
        <p role="status">Загружаем программу…</p>
      ) : query.data?.kind === "ready" ? (
        <PlacementForm
          key={query.data.order.orderVersion}
          order={query.data.order}
          onSaved={() => {
            void query.refetch();
          }}
        />
      ) : (
        <p role="alert">
          Не удалось загрузить программу.{" "}
          <Button
            type="button"
            onClick={() => {
              void query.refetch();
            }}
          >
            Повторить
          </Button>
        </p>
      )}
    </section>
  );
}
function PlacementForm({
  order,
  onSaved,
}: {
  readonly order: Omit<SeriesOrderPresentation, "options">;
  readonly onSaved: () => void;
}) {
  const [placements, setPlacements] = useState<
    readonly ProgrammePlacementPresentation[]
  >(order.programmePlacements ?? []);
  const [materialId, setMaterialId] = useState(
    order.items[0]?.materialId ?? "",
  );
  const [chapterId, setChapterId] = useState(order.chapters[0]?.id ?? "");
  const mutation = useMutation({ mutationFn: reorderSeries });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const candidates = order.items.filter((item) =>
    item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const choices = candidates.slice(page * 20, (page + 1) * 20);
  const selectedMaterial = order.items.find(
    (item) => item.materialId === materialId,
  );
  const groups =
    order.chapters.length === 0
      ? [{ id: null, name: "Программа" }]
      : order.chapters;
  const move = (id: string, offset: number) => {
    const next = [...placements];
    const index = next.findIndex((entry) => entry.id === id);
    const destination = index + offset;
    if (next[index]?.chapterId !== next[destination]?.chapterId) return;
    const [entry] = next.splice(index, 1);
    if (entry === undefined) return;
    next.splice(destination, 0, entry);
    setPlacements(next);
  };
  return (
    <div className="grid gap-4">
      {groups.map((chapter) => (
        <section key={chapter.id ?? "flat"} className="grid gap-2">
          <h3 className="font-medium">{chapter.name}</h3>
          <ol className="grid gap-2">
            {placements
              .filter((entry) => entry.chapterId === chapter.id)
              .map((entry, index, rows) => (
                <li key={entry.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {index + 1}.{" "}
                    {
                      order.items.find(
                        (item) => item.materialId === entry.materialId,
                      )?.title
                    }
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Поднять размещение"
                    disabled={mutation.isPending || index === 0}
                    onClick={() => {
                      move(entry.id, -1);
                    }}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Опустить размещение"
                    disabled={mutation.isPending || index === rows.length - 1}
                    onClick={() => {
                      move(entry.id, 1);
                    }}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Убрать размещение"
                    disabled={mutation.isPending}
                    onClick={() => {
                      setPlacements(
                        placements.filter((item) => item.id !== entry.id),
                      );
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
          </ol>
        </section>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Поиск материала
          <input
            className="min-h-11 rounded-lg border border-border bg-background px-3"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Материал
          <select
            className="max-w-full rounded-lg border border-border bg-background p-2"
            value={materialId}
            disabled={mutation.isPending}
            onChange={(event) => {
              setMaterialId(event.target.value);
            }}
          >
            {selectedMaterial !== undefined &&
            !choices.some((item) => item.materialId === materialId) ? (
              <option value={materialId}>{selectedMaterial.title}</option>
            ) : null}
            {choices.map((item) => (
              <option key={item.materialId} value={item.materialId}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-muted-foreground">
          {candidates.length === 0
            ? "Материалы не найдены"
            : `${String(page * 20 + 1)}–${String(Math.min((page + 1) * 20, candidates.length))} из ${String(candidates.length)}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          disabled={page === 0}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          Назад по списку
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={(page + 1) * 20 >= candidates.length}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          Дальше по списку
        </Button>
        {order.chapters.length > 0 ? (
          <label className="grid gap-1 text-sm">
            Глава
            <select
              className="rounded-lg border border-border bg-background p-2"
              value={chapterId}
              disabled={mutation.isPending}
              onChange={(event) => {
                setChapterId(event.target.value);
              }}
            >
              {order.chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending || materialId === ""}
          onClick={() => {
            const next = [
              ...placements,
              {
                id: crypto.randomUUID(),
                materialId,
                chapterId: chapterId === "" ? null : chapterId,
                stepGroup: null,
              },
            ];
            next.sort(
              (left, right) =>
                order.chapters.findIndex(
                  (chapter) => chapter.id === left.chapterId,
                ) -
                order.chapters.findIndex(
                  (chapter) => chapter.id === right.chapterId,
                ),
            );
            setPlacements(next);
          }}
        >
          Добавить размещение
        </Button>
      </div>
      <Button
        type="button"
        className="justify-self-start"
        disabled={
          mutation.isPending ||
          JSON.stringify(placements) ===
            JSON.stringify(order.programmePlacements ?? [])
        }
        onClick={() => {
          mutation.mutate(
            {
              seriesId: order.seriesId,
              expectedOrderVersion: order.orderVersion,
              orderedMaterialIds: order.items.map((item) => item.materialId),
              chapters: order.chapters,
              programmePlacements: placements,
            },
            {
              onSuccess: (result) => {
                if (result.kind === "saved") onSaved();
              },
            },
          );
        }}
      >
        {mutation.isPending ? "Сохраняем…" : "Сохранить программу"}
      </Button>
      {mutation.data !== undefined && mutation.data.kind !== "saved" ? (
        <p role="alert">
          {mutation.data.kind === "conflict"
            ? "Программа изменилась. Перечитайте её перед сохранением."
            : "Не удалось сохранить программу."}{" "}
          <Button type="button" variant="ghost" onClick={onSaved}>
            Перечитать
          </Button>
        </p>
      ) : null}
      {mutation.isError ? (
        <p role="alert">Не удалось сохранить программу. Повторите попытку.</p>
      ) : null}
    </div>
  );
}
