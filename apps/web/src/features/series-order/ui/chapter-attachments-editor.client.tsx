"use client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { updateChapterAttachments } from "../api/chapter-attachments.browser";
import type {
  ProductChapterPresentation,
  SeriesOrderItemPresentation,
} from "../model/presentation";

/** Navigation attachments are editable even while source-owned programme composition stays read-only. */
export function ChapterAttachmentsEditor({
  chapter,
  items,
  productId,
  orderVersion,
  onRefresh,
}: {
  readonly chapter: ProductChapterPresentation;
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly productId: string;
  readonly orderVersion: string;
  readonly onRefresh: () => void;
}) {
  const [selected, setSelected] = useState([
    ...(chapter.supplementaryMaterialIds ?? []),
  ]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const candidates = items.filter(
    (item) =>
      !selected.includes(item.materialId) &&
      item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(candidates.length / 20) - 1),
  );
  const mutation = useMutation({ mutationFn: updateChapterAttachments });
  const dirty =
    JSON.stringify(selected) !==
    JSON.stringify(chapter.supplementaryMaterialIds ?? []);
  const move = (index: number, offset: number) => {
    const next = [...selected];
    const [id] = next.splice(index, 1);
    if (id === undefined) return;
    next.splice(index + offset, 0, id);
    setSelected(next);
  };
  return (
    <details className="rounded-xl bg-muted/40 p-4">
      <summary className="cursor-pointer font-medium">
        Дополнительные материалы · {chapter.name}
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Ссылки под шагами главы. Программа и прогресс не изменяются.
      </p>
      <ul className="mt-3 grid gap-2">
        {selected.map((id, index) => (
          <li className="flex items-center gap-2" key={id}>
            <span className="min-w-0 flex-1 text-sm">
              {items.find((item) => item.materialId === id)?.title ??
                "Материал недоступен"}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={mutation.isPending || index === 0}
              aria-label="Поднять материал"
              onClick={() => {
                move(index, -1);
              }}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={mutation.isPending || index === selected.length - 1}
              aria-label="Опустить материал"
              onClick={() => {
                move(index, 1);
              }}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={mutation.isPending}
              aria-label="Убрать привязку"
              onClick={() => {
                setSelected(selected.filter((entry) => entry !== id));
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <label className="mt-4 block text-sm">
        Добавить материал продукта
        <input
          className="mt-1 block min-h-11 w-full rounded-lg border border-input bg-background px-3"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(0);
          }}
          placeholder="Поиск по названию"
        />
      </label>
      <ul className="mt-2 grid gap-1">
        {candidates
          .slice(currentPage * 20, (currentPage + 1) * 20)
          .map((item) => (
            <li key={item.materialId}>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 h-auto w-full justify-start whitespace-normal text-left"
                disabled={mutation.isPending || selected.length >= 200}
                onClick={() => {
                  setSelected([...selected, item.materialId]);
                }}
              >
                <Plus aria-hidden="true" />
                {item.title}
              </Button>
            </li>
          ))}
      </ul>
      <div className="my-2 flex flex-wrap items-center gap-2 text-sm">
        <span>
          {candidates.length === 0
            ? "Нет материалов для добавления"
            : `${String(currentPage * 20 + 1)}–${String(Math.min((currentPage + 1) * 20, candidates.length))} из ${String(candidates.length)}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          disabled={currentPage === 0}
          onClick={() => {
            setPage(currentPage - 1);
          }}
        >
          Назад по списку
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={(currentPage + 1) * 20 >= candidates.length}
          onClick={() => {
            setPage(currentPage + 1);
          }}
        >
          Дальше по списку
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!dirty || mutation.isPending}
          onClick={() => {
            mutation.mutate(
              {
                productId,
                chapterId: chapter.id,
                expectedOrderVersion: orderVersion,
                materialIds: selected,
              },
              {
                onSuccess: (result) => {
                  if (result.kind === "saved") onRefresh();
                },
              },
            );
          }}
        >
          {mutation.isPending ? "Сохраняем…" : "Сохранить привязки"}
        </Button>
        {mutation.isError ||
        (mutation.data !== undefined && mutation.data.kind !== "saved") ? (
          <p role="alert" className="text-sm">
            {mutation.data?.kind === "conflict"
              ? "Состав изменился. Обновите список перед сохранением."
              : "Не удалось сохранить привязки."}{" "}
            <Button type="button" variant="link" onClick={onRefresh}>
              Обновить
            </Button>
          </p>
        ) : mutation.data?.kind === "saved" ? (
          <p role="status" className="text-sm">
            Сохранено
          </p>
        ) : null}
      </div>
    </details>
  );
}
