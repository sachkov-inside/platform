"use client";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { updateProductTopics } from "../api/product-topics.browser";
import {
  PRODUCT_TOPICS_MAX,
  PRODUCT_TOPIC_NAME_MAX,
  PRODUCT_TOPIC_SUMMARY_MAX,
  type OrderVersionRef,
  type ProductOrderItemPresentation,
  type ProductTopicPresentation,
} from "../model/presentation";

const PAGE_SIZE = 20;
const NO_TOPIC = "";

interface Draft {
  readonly topics: readonly Omit<ProductTopicPresentation, "materialIds">[];
  /** Material id → topic id; a Material without a topic has no key. */
  readonly assignments: Readonly<Record<string, string>>;
}

function draftOf(topics: readonly ProductTopicPresentation[]): Draft {
  return {
    topics: topics.map(({ id, name, summary }) => ({ id, name, summary })),
    assignments: Object.fromEntries(
      topics.flatMap((topic) =>
        topic.materialIds.map((materialId) => [materialId, topic.id]),
      ),
    ),
  };
}

/**
 * Темы курса (#2022): полки каталога «Материалы». Автор задаёт порядок тем и ставит каждый
 * материал курса не больше чем в одну тему. Темы редактируются и у курса из источника: они
 * меняют только раскладку каталога, не программу.
 */
export function ProductTopicsEditor({
  items,
  onRefresh,
  orderVersion,
  orderVersionRef,
  productId,
  topics,
}: {
  readonly items: readonly ProductOrderItemPresentation[];
  readonly onRefresh: () => Promise<{
    readonly orderVersion: string;
    readonly topics: readonly ProductTopicPresentation[];
  } | null>;
  readonly orderVersion: string;
  /**
   * Версия состава, общая с другими редакторами панели: темы входят в неё, поэтому после
   * сохранения тем следующая правка состава идёт от новой версии без перечитывания.
   */
  readonly orderVersionRef?: OrderVersionRef;
  readonly productId: string;
  readonly topics: readonly ProductTopicPresentation[];
}) {
  const headingId = useId();
  const ownVersion = useRef(orderVersion);
  const version = orderVersionRef ?? ownVersion;
  const [saved, setSaved] = useState(() => draftOf(topics));
  const [draft, setDraft] = useState(saved);
  const [search, setSearch] = useState("");
  const [onlyWithout, setOnlyWithout] = useState(false);
  const [page, setPage] = useState(0);
  const mutation = useMutation({ mutationFn: updateProductTopics });
  const refresh = useMutation({ mutationFn: onRefresh });
  const pending = mutation.isPending || refresh.isPending;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const blank = draft.topics.some((topic) => topic.name.trim().length === 0);
  const known = new Set(draft.topics.map((topic) => topic.id));
  const topicOf = (materialId: string) => {
    const topicId = draft.assignments[materialId];
    return topicId !== undefined && known.has(topicId) ? topicId : NO_TOPIC;
  };
  const needle = search.trim().toLocaleLowerCase("ru");
  const candidates = items.filter(
    (item) =>
      item.title.toLocaleLowerCase("ru").includes(needle) &&
      (!onlyWithout || topicOf(item.materialId) === NO_TOPIC),
  );
  const pages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const withoutTopic = items.filter(
    (item) => topicOf(item.materialId) === NO_TOPIC,
  ).length;
  const changeTopic = (
    index: number,
    change: Partial<Omit<ProductTopicPresentation, "id" | "materialIds">>,
  ) => {
    setDraft({
      ...draft,
      topics: draft.topics.map((topic, at) =>
        at === index ? { ...topic, ...change } : topic,
      ),
    });
  };
  const move = (index: number, offset: number) => {
    const next = [...draft.topics];
    const [topic] = next.splice(index, 1);
    if (topic === undefined) return;
    next.splice(index + offset, 0, topic);
    setDraft({ ...draft, topics: next });
  };
  const save = () => {
    const sent = draft.topics.map((topic) => ({
      id: topic.id,
      name: topic.name.trim(),
      summary: topic.summary.trim(),
      materialIds: items
        .map((item) => item.materialId)
        .filter((materialId) => topicOf(materialId) === topic.id),
    }));
    mutation.mutate(
      {
        productId,
        expectedOrderVersion: version.current,
        topics: sent,
      },
      {
        onSuccess: (result) => {
          if (result.kind !== "saved") return;
          version.current = result.orderVersion;
          const next = draftOf(sent);
          setSaved(next);
          setDraft(next);
        },
      },
    );
  };
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 rounded-xl bg-muted/40 p-4"
      data-product-topics-editor
    >
      <div>
        <h2 className="font-semibold" id={headingId}>
          Темы курса
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Полки каталога «Материалы» в этом порядке. Материал стоит не больше
          чем в одной теме; программа и прогресс не меняются.
        </p>
      </div>
      {draft.topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Тем нет: каталог показывает все материалы одним списком.
        </p>
      ) : (
        <ol className="grid gap-3">
          {draft.topics.map((topic, index) => (
            <li
              className="grid gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[1fr_auto]"
              key={topic.id}
            >
              <div className="grid gap-2">
                <label className="grid gap-1 text-sm">
                  Название темы
                  <input
                    className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
                    disabled={pending}
                    maxLength={PRODUCT_TOPIC_NAME_MAX}
                    onChange={(event) => {
                      changeTopic(index, { name: event.currentTarget.value });
                    }}
                    value={topic.name}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Описание, видно в открытой теме
                  <input
                    className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
                    disabled={pending}
                    maxLength={PRODUCT_TOPIC_SUMMARY_MAX}
                    onChange={(event) => {
                      changeTopic(index, {
                        summary: event.currentTarget.value,
                      });
                    }}
                    value={topic.summary}
                  />
                </label>
              </div>
              <div className="flex items-start gap-1">
                <Button
                  aria-label={`Поднять тему «${topic.name}»`}
                  disabled={pending || index === 0}
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
                  aria-label={`Опустить тему «${topic.name}»`}
                  disabled={pending || index === draft.topics.length - 1}
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
                  aria-label={`Удалить тему «${topic.name}»`}
                  disabled={pending}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      topics: draft.topics.filter((entry) => entry !== topic),
                    });
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div>
        <Button
          disabled={pending || draft.topics.length >= PRODUCT_TOPICS_MAX}
          onClick={() => {
            setDraft({
              ...draft,
              topics: [
                ...draft.topics,
                { id: crypto.randomUUID(), name: "", summary: "" },
              ],
            });
          }}
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" />
          Добавить тему
        </Button>
      </div>
      {draft.topics.length === 0 || items.length === 0 ? null : (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            Материалы курса · без темы: {withoutTopic}
          </legend>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 flex-1 gap-1 text-sm">
              Найти материал
              <input
                className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  setPage(0);
                }}
                placeholder="Поиск по названию"
                value={search}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                checked={onlyWithout}
                className="size-4"
                onChange={(event) => {
                  setOnlyWithout(event.currentTarget.checked);
                  setPage(0);
                }}
                type="checkbox"
              />
              Только без темы
            </label>
          </div>
          <ul className="grid gap-1">
            {candidates
              .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
              .map((item) => (
                <li
                  className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                  key={item.materialId}
                >
                  <span className="min-w-0 flex-1 text-sm">{item.title}</span>
                  <select
                    aria-label={`Тема материала «${item.title}»`}
                    className="min-h-11 max-w-full rounded-lg border border-input bg-background px-2 text-base"
                    disabled={pending}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      const assignments = Object.fromEntries(
                        Object.entries(draft.assignments).filter(
                          ([materialId]) => materialId !== item.materialId,
                        ),
                      );
                      if (value !== NO_TOPIC)
                        assignments[item.materialId] = value;
                      setDraft({ ...draft, assignments });
                    }}
                    value={topicOf(item.materialId)}
                  >
                    <option value={NO_TOPIC}>Без темы</option>
                    {draft.topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name.trim().length === 0
                          ? "Тема без названия"
                          : topic.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {candidates.length === 0
                ? "Ничего не нашлось"
                : `${String(currentPage * PAGE_SIZE + 1)}–${String(Math.min((currentPage + 1) * PAGE_SIZE, candidates.length))} из ${String(candidates.length)}`}
            </span>
            <Button
              disabled={currentPage === 0}
              onClick={() => {
                setPage(currentPage - 1);
              }}
              type="button"
              variant="ghost"
            >
              Назад по списку
            </Button>
            <Button
              disabled={currentPage >= pages - 1}
              onClick={() => {
                setPage(currentPage + 1);
              }}
              type="button"
              variant="ghost"
            >
              Дальше по списку
            </Button>
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || blank || pending}
          onClick={save}
          type="button"
        >
          {mutation.isPending ? "Сохраняем…" : "Сохранить темы"}
        </Button>
        {blank ? (
          <p className="text-sm text-muted-foreground">
            У каждой темы должно быть название.
          </p>
        ) : null}
        {mutation.isError ||
        (mutation.data !== undefined && mutation.data.kind !== "saved") ? (
          <p className="text-sm" role="alert">
            {mutation.data?.kind === "conflict"
              ? "Состав курса изменился. Обновите темы перед сохранением."
              : "Не удалось сохранить темы."}{" "}
            <Button
              disabled={pending}
              onClick={() => {
                refresh.mutate(undefined, {
                  onSuccess: (fresh) => {
                    if (fresh === null) return;
                    const next = draftOf(fresh.topics);
                    version.current = fresh.orderVersion;
                    setSaved(next);
                    setDraft(next);
                    mutation.reset();
                  },
                });
              }}
              type="button"
              variant="link"
            >
              Обновить
            </Button>
          </p>
        ) : mutation.data?.kind === "saved" && !dirty ? (
          <p className="text-sm" role="status">
            Сохранено
          </p>
        ) : null}
      </div>
    </section>
  );
}
