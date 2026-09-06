"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowDown, ListOrdered, Plus, Send } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import type * as Browser from "../api/communications.browser";
import {
  draftSchema,
  lifecycleLabels,
  messages,
  newFunnel,
  newPart,
  type Failure,
  type Funnel,
  type Intro,
  type Preview,
  type Result,
} from "../model/communications";
import { DeliveryHistory } from "./delivery-history.client";
import { fieldClass, moveItem, PartsEditor } from "./parts-editor.client";

export type CommunicationsActions = typeof Browser;
/**
 * Temporary semantic UI for #308.
 * Replace through #316 after Storybook acceptance.
 */
export function CommunicationsWorkspace({
  actions,
}: {
  actions: CommunicationsActions;
}) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<Funnel | null>(null);
  const [saved, setSaved] = useState<Funnel | null>(null);
  const [introDraft, setIntroDraft] = useState<Intro | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [deliveryCursor, setDeliveryCursor] = useState<string | undefined>();
  // Retain an operation identity for the same attempted payload, including after an ambiguous response.
  const operationIds = useRef(new Map<string, string>());
  function operationId(input: unknown): string {
    const key = JSON.stringify(input);
    const prior = operationIds.current.get(key);
    if (prior) return prior;
    const next = crypto.randomUUID();
    operationIds.current.set(key, next);
    return next;
  }
  const list = useQuery({
    queryKey: ["communications", "funnels", cursor],
    queryFn: () => actions.listFunnels(cursor ? { cursor } : {}),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const intro = useQuery({
    queryKey: ["communications", "intro"],
    queryFn: () => actions.readIntro({}),
    retry: false,
    refetchOnWindowFocus: false,
    enabled: list.data?.kind === "ready",
  });
  const deliveries = useQuery({
    queryKey: [
      "communications",
      "deliveries",
      selected?.funnelId,
      deliveryCursor,
    ],
    queryFn: () =>
      selected
        ? actions.readDeliveries({
            funnelId: selected.funnelId,
            ...(deliveryCursor ? { cursor: deliveryCursor } : {}),
          })
        : Promise.resolve({
            kind: "error" as const,
            code: "not_found" as const,
          }),
    enabled: selected !== null && selected.revision > 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const dirty =
    selected !== null && JSON.stringify(selected) !== JSON.stringify(saved);
  function received<T>(result: Result<T>, success: (value: T) => void) {
    if (result.kind === "error") {
      setFailure(result);
      setNotice("");
    } else {
      setFailure(null);
      success(result.value);
    }
  }
  function acceptFunnel(funnel: Funnel) {
    setSelected(funnel);
    setSaved(funnel);
    setPreview(null);
    setDeliveryCursor(undefined);
    void cache.invalidateQueries({ queryKey: ["communications", "funnels"] });
    void cache.invalidateQueries({
      queryKey: ["communications", "deliveries"],
    });
  }
  const save = useMutation({
    mutationFn: actions.saveFunnel,
    onSuccess: (result) => {
      received(result, (value) => {
        acceptFunnel(value);
        setNotice("Черновик сохранён. Опубликованные сообщения не изменены.");
      });
    },
  });
  const publish = useMutation({
    mutationFn: actions.publishFunnel,
    onSuccess: (result) => {
      received(result, (value) => {
        acceptFunnel(value);
        setNotice(
          "Воронка опубликована. Отправленные шаги не будут повторены.",
        );
      });
    },
  });
  const previewMutation = useMutation({
    mutationFn: actions.previewFunnel,
    onMutate: () => {
      setPreview(null);
    },
    onSuccess: (result) => {
      received(result, (value) => {
        setPreview(value);
        setNotice("Предпросмотр готов. Сообщения не отправлялись.");
      });
    },
  });
  const lifecycle = useMutation({
    mutationFn: actions.changeFunnelLifecycle,
    onSuccess: (result) => {
      received(result, (value) => {
        acceptFunnel(value);
        setNotice("Состояние воронки обновлено.");
      });
    },
  });
  const saveIntro = useMutation({
    mutationFn: actions.saveIntro,
    onSuccess: (result) => {
      received(result, (value) => {
        setIntroDraft(value);
        cache.setQueryData(["communications", "intro"], result);
        setNotice(
          "Общее знакомство обновлено. Прежние получатели не получат его повторно.",
        );
      });
    },
  });
  const resolveTemplate = useMutation({
    mutationFn: actions.resolveTemplate,
    onSuccess: (result) => {
      if (result.kind === "error") setFailure(result);
    },
  });
  const skip = useMutation({
    mutationFn: actions.skipDelivery,
    onSuccess: (result) => {
      received(result, () => {
        setNotice("Часть пропущена.");
        void cache.invalidateQueries({
          queryKey: ["communications", "deliveries"],
        });
      });
    },
  });
  const retry = useMutation({
    mutationFn: actions.retryDelivery,
    onSuccess: (result) => {
      received(result, () => {
        setNotice(
          "Повтор запрошен. Подтверждение отправки появится в истории.",
        );
        void cache.invalidateQueries({
          queryKey: ["communications", "deliveries"],
        });
      });
    },
  });
  const reload = useMutation({
    mutationFn: actions.readFunnel,
    onSuccess: (result) => {
      received(result, (value) => {
        acceptFunnel(value);
        setNotice("Актуальное состояние загружено. Локальные правки заменены.");
      });
    },
  });
  const busy =
    reload.isPending ||
    save.isPending ||
    publish.isPending ||
    previewMutation.isPending ||
    lifecycle.isPending ||
    saveIntro.isPending ||
    resolveTemplate.isPending ||
    skip.isPending ||
    retry.isPending;
  const activeIntro =
    introDraft ?? (intro.data?.kind === "ready" ? intro.data.value : null);
  const resolve = (reference: string) =>
    resolveTemplate.mutateAsync({
      reference,
      operationId: crypto.randomUUID(),
    });
  function edit(value: Funnel) {
    setSelected(value);
    setPreview(null);
    setNotice("");
  }
  function command() {
    if (!selected) throw new Error("No selected funnel");
    return { funnelId: selected.funnelId, expectedRevision: selected.revision };
  }
  const listFailure =
    list.data?.kind === "error"
      ? list.data
      : list.isError
        ? { kind: "error" as const, code: "unavailable" as const }
        : null;
  return (
    <main
      id="authoring-content"
      className="h-full overflow-y-auto px-4 py-6 md:px-8 md:py-10 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal [&_[data-slot=button]]:px-4 [&_[data-slot=button]]:py-2 [&_input[type=checkbox]]:size-5 [&_input[type=checkbox]]:shrink-0 [&_input[type=checkbox]]:accent-primary [&_input[type=checkbox]]:focus-visible:outline-2 [&_input[type=checkbox]]:focus-visible:outline-offset-4 [&_input[type=checkbox]]:focus-visible:outline-ring [&_summary]:focus-visible:outline-2 [&_summary]:focus-visible:outline-offset-4 [&_summary]:focus-visible:outline-ring"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-3 border-b border-border pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <Send aria-hidden="true" className="size-4" /> Telegram · общение
              с участниками
            </p>
            <Link
              className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              href="/authoring/communications/broadcasts"
            >
              Рассылки и аналитика
            </Link>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Воронки Telegram
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Настройте знакомство, ответ по ссылке и последовательность
            сообщений. Сохраните черновик, проверьте охват и опубликуйте
            изменения.
          </p>
        </header>
        <div
          aria-live="polite"
          aria-atomic="true"
          className="min-h-12 text-sm leading-6 text-muted-foreground"
        >
          {busy ? "Выполняем операцию…" : notice}
        </div>
        {failure ? (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6"
          >
            <p className="font-semibold">
              {failure.code === "conflict"
                ? "Черновик изменился в другой сессии"
                : "Операция не завершена"}
            </p>
            <p>{messages[failure.code]}</p>
            {failure.code === "unauthorized" ? (
              <Link href="/auth/sign-in">Войти</Link>
            ) : failure.code === "link_required" ? (
              <Link href="/account">Открыть аккаунт</Link>
            ) : null}
          </div>
        ) : null}
        {list.isPending ? (
          <div
            role="status"
            className="space-y-5 rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm text-muted-foreground">Загружаем воронки…</p>
            <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
              {[0, 1].map((key) => (
                <div
                  key={key}
                  className="h-36 rounded-lg bg-muted motion-safe:animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : listFailure ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="mb-2 text-lg font-semibold">
              Не удалось открыть воронки
            </h2>
            <p className="text-sm text-muted-foreground">
              {messages[listFailure.code]}
            </p>
            <Button
              type="button"
              className="mt-3 min-h-12"
              onClick={() => void list.refetch()}
            >
              Повторить загрузку
            </Button>
          </div>
        ) : list.data?.kind === "ready" ? (
          <>
            <section
              aria-labelledby="funnel-list-heading"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="funnel-list-heading" className="text-xl font-semibold">
                  Ваши воронки
                </h2>
                <Button
                  type="button"
                  className="min-h-12"
                  disabled={busy || dirty}
                  onClick={() => {
                    const value = newFunnel();
                    setSelected(value);
                    setSaved(value);
                    setPreview(null);
                    setFailure(null);
                  }}
                >
                  <Plus aria-hidden="true" className="size-4" /> Создать воронку
                </Button>
              </div>
              {list.data.value.funnels.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
                  <ListOrdered
                    aria-hidden="true"
                    className="mx-auto mb-4 size-7 text-muted-foreground"
                  />
                  <h3 className="text-lg font-semibold">
                    Первый шаг к знакомству
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    Воронок пока нет. Начните со стандартной — она открывается
                    при обычном запуске бота.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {list.data.value.funnels.map((funnel) => (
                    <li
                      key={funnel.funnelId}
                      className={`flex min-w-0 flex-col items-start gap-4 rounded-xl border bg-card p-5 ${selected?.funnelId === funnel.funnelId ? "border-ring ring-1 ring-ring" : "border-border"}`}
                    >
                      <div className="min-w-0">
                        <h3 className="break-words text-lg font-semibold">
                          {funnel.name}
                        </h3>
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <FunnelStatus lifecycle={funnel.lifecycle} />
                          {funnel.isDefault ? "Стандартная" : "Тематическая"} ·
                          Шагов: {funnel.steps.length}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-auto min-h-12 w-full"
                        aria-pressed={selected?.funnelId === funnel.funnelId}
                        aria-label={`Открыть ${funnel.name}`}
                        disabled={busy || dirty}
                        onClick={() => {
                          setSelected(funnel);
                          setSaved(funnel);
                          setPreview(null);
                          setFailure(null);
                          setDeliveryCursor(undefined);
                        }}
                      >
                        {selected?.funnelId === funnel.funnelId
                          ? "Открыта в редакторе"
                          : "Открыть воронку"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-3">
                {cursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    disabled={busy || dirty}
                    onClick={() => {
                      setCursor(undefined);
                    }}
                  >
                    В начало списка
                  </Button>
                ) : null}
                {list.data.value.nextCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    disabled={busy || dirty}
                    onClick={() => {
                      if (list.data?.kind === "ready")
                        setCursor(list.data.value.nextCursor ?? undefined);
                    }}
                  >
                    Следующие воронки
                  </Button>
                ) : null}
              </div>
              {dirty ? (
                <p className="text-sm text-muted-foreground">
                  Сохраните правки или отмените их перед переключением воронки.
                </p>
              ) : null}
            </section>
            <details className="rounded-xl border border-border bg-card p-5">
              <summary className="cursor-pointer py-2 text-base font-semibold">
                Общее знакомство · один раз на человека
              </summary>
              <div className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Отправляется перед первым входом в любую воронку. Изменение
                  этого блока не повторяет знакомство. Сохранение сразу меняет
                  блок для новых получателей.
                </p>
                {intro.isPending ? (
                  <p role="status">Загружаем знакомство…</p>
                ) : intro.data?.kind === "error" &&
                  intro.data.code !== "not_found" ? (
                  <p role="alert">{messages[intro.data.code]}</p>
                ) : activeIntro ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const input = {
                        introId: activeIntro.introId,
                        expectedRevision: activeIntro.revision,
                        parts: activeIntro.parts,
                      };
                      saveIntro.mutate({
                        ...input,
                        operationId: operationId(["intro", input]),
                      });
                    }}
                    className="space-y-4"
                  >
                    <PartsEditor
                      label="Части общего знакомства"
                      parts={activeIntro.parts}
                      disabled={busy}
                      resolveTemplate={resolve}
                      onChange={(parts) => {
                        setIntroDraft({ ...activeIntro, parts });
                      }}
                    />
                    <Button type="submit" className="min-h-12" disabled={busy}>
                      Сохранить общее знакомство
                    </Button>
                  </form>
                ) : (
                  <Button
                    type="button"
                    className="min-h-12"
                    onClick={() => {
                      setIntroDraft({
                        introId: crypto.randomUUID(),
                        revision: 0,
                        parts: [newPart()],
                      });
                    }}
                  >
                    Создать общее знакомство
                  </Button>
                )}
              </div>
            </details>
            {selected ? (
              <section aria-label="Редактор воронки" className="space-y-6">
                <h2 className="break-words text-2xl font-semibold tracking-tight">
                  {selected.revision === 0 ? "Новая воронка" : selected.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  <FunnelStatus lifecycle={selected.lifecycle} /> ·
                  Опубликованная версия:{" "}
                  {selected.publishedRevision ?? "ещё нет"} ·{" "}
                  {dirty
                    ? "Есть несохранённые правки"
                    : "Черновик без несохранённых правок"}
                </p>
                <form
                  className="space-y-8"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const parsed = draftSchema.safeParse(selected);
                    if (!parsed.success) {
                      setFailure({ kind: "error", code: "invalid" });
                      return;
                    }
                    const input = {
                      expectedRevision: selected.revision,
                      draft: parsed.data,
                    };
                    save.mutate({
                      ...input,
                      operationId: operationId(["save", input]),
                    });
                  }}
                >
                  <fieldset disabled={busy} className="min-w-0 space-y-6">
                    <legend className="sr-only">Настройки воронки</legend>
                    <div className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
                      <label className="block text-sm font-medium">
                        Название воронки
                        <input
                          className={fieldClass}
                          name="funnel-name"
                          required
                          maxLength={128}
                          value={selected.name}
                          onChange={(e) => {
                            edit({ ...selected, name: e.target.value });
                          }}
                        />
                      </label>
                      <label className="flex min-h-12 items-center gap-3">
                        <input
                          name="default-funnel"
                          type="checkbox"
                          checked={selected.isDefault}
                          onChange={(e) => {
                            edit({ ...selected, isDefault: e.target.checked });
                          }}
                        />
                        Стандартная воронка для обычного запуска бота
                      </label>
                      <p className="text-sm text-muted-foreground">
                        Назначение вступает в силу при публикации. Тематическая
                        ссылка не подписывает человека на стандартную воронку.
                      </p>
                    </div>
                    <div className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
                      <PartsEditor
                        label="Непосредственный ответ по ссылке"
                        parts={selected.entryResponse.parts}
                        resolveTemplate={resolve}
                        onChange={(parts) => {
                          edit({
                            ...selected,
                            entryResponse: { ...selected.entryResponse, parts },
                          });
                        }}
                      />
                      <p className="text-sm text-muted-foreground">
                        Повторный вход возвращает этот ответ, сохраняя
                        расписание и уже отправленные шаги.
                      </p>
                    </div>
                    <section className="space-y-5">
                      <h3 className="flex items-center gap-2 text-xl font-semibold">
                        <ArrowDown
                          aria-hidden="true"
                          className="size-5 text-muted-foreground"
                        />{" "}
                        Отложенные шаги
                      </h3>
                      {selected.steps.length === 0 ? (
                        <p>Отложенных шагов пока нет.</p>
                      ) : null}
                      {selected.steps.map((step, index) => (
                        <section
                          key={step.stepId}
                          aria-label={`Шаг ${String(index + 1)}`}
                          className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-lg font-semibold">
                              Шаг {index + 1}
                            </h3>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                className="min-h-11"
                                disabled={index === 0}
                                onClick={() => {
                                  edit({
                                    ...selected,
                                    steps: moveItem(selected.steps, index, -1),
                                  });
                                }}
                              >
                                Шаг {index + 1} выше
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="min-h-11"
                                disabled={index === selected.steps.length - 1}
                                onClick={() => {
                                  edit({
                                    ...selected,
                                    steps: moveItem(selected.steps, index, 1),
                                  });
                                }}
                              >
                                Шаг {index + 1} ниже
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="min-h-11"
                                onClick={() => {
                                  edit({
                                    ...selected,
                                    steps: selected.steps.filter(
                                      (_, at) => at !== index,
                                    ),
                                  });
                                }}
                              >
                                Удалить шаг {index + 1}
                              </Button>
                            </div>
                          </div>
                          <label className="block max-w-xs text-sm font-medium">
                            Задержка после предыдущего шага, секунд
                            <input
                              className={fieldClass}
                              name={`delay-${step.stepId}`}
                              type="number"
                              min={0}
                              max={2147483647}
                              step={1}
                              required
                              value={step.delaySeconds}
                              onChange={(e) => {
                                edit({
                                  ...selected,
                                  steps: selected.steps.map((s, at) =>
                                    at === index
                                      ? {
                                          ...s,
                                          delaySeconds: e.target.valueAsNumber,
                                        }
                                      : s,
                                  ),
                                });
                              }}
                            />
                          </label>
                          <p className="text-sm text-muted-foreground">
                            86 400 секунд = 1 день. Для нового шага прежним
                            участникам отсчёт начнётся не раньше публикации.
                          </p>
                          <PartsEditor
                            label={`Части шага ${String(index + 1)}`}
                            parts={step.parts}
                            resolveTemplate={resolve}
                            onChange={(parts) => {
                              edit({
                                ...selected,
                                steps: selected.steps.map((s, at) =>
                                  at === index ? { ...s, parts } : s,
                                ),
                              });
                            }}
                          />
                        </section>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-12"
                        disabled={selected.steps.length >= 100}
                        onClick={() => {
                          edit({
                            ...selected,
                            steps: [
                              ...selected.steps,
                              {
                                stepId: crypto.randomUUID(),
                                delaySeconds: 86400,
                                parts: [newPart()],
                              },
                            ],
                          });
                        }}
                      >
                        Добавить шаг
                      </Button>
                    </section>
                    <section className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
                      <h3 className="text-xl font-semibold">Источники входа</h3>
                      <p className="text-sm text-muted-foreground">
                        Несколько источников могут вести в одну воронку. Код
                        остаётся неизменным после сохранения. Новые ссылки
                        начинают работать после публикации.
                      </p>
                      {selected.sources.map((source, index) => (
                        <div
                          key={source.sourceId}
                          className="space-y-3 rounded-lg border border-border bg-background p-4"
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-sm">
                              Название источника
                              <input
                                className={fieldClass}
                                name={`source-name-${source.sourceId}`}
                                required
                                maxLength={128}
                                value={source.name}
                                onChange={(e) => {
                                  edit({
                                    ...selected,
                                    sources: selected.sources.map((s, at) =>
                                      at === index
                                        ? { ...s, name: e.target.value }
                                        : s,
                                    ),
                                  });
                                }}
                              />
                            </label>
                            <label className="text-sm">
                              Код источника
                              <input
                                className={fieldClass}
                                name={`source-code-${source.sourceId}`}
                                required
                                pattern="m_[A-Za-z0-9_-]+"
                                maxLength={42}
                                readOnly={saved?.sources.some(
                                  (s) => s.sourceId === source.sourceId,
                                )}
                                value={source.code}
                                onChange={(e) => {
                                  edit({
                                    ...selected,
                                    sources: selected.sources.map((s, at) =>
                                      at === index
                                        ? { ...s, code: e.target.value }
                                        : s,
                                    ),
                                  });
                                }}
                              />
                            </label>
                          </div>
                          <p className="break-all text-sm">
                            Аргумент ссылки запуска: <code>{source.code}</code>
                          </p>
                          {list.data?.kind === "ready" ? (
                            <a
                              className="block break-all text-sm underline underline-offset-4"
                              href={`${list.data.value.botStartUrl}?start=${encodeURIComponent(source.code)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {list.data.value.botStartUrl}?start={source.code}
                            </a>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11"
                            onClick={() => {
                              edit({
                                ...selected,
                                sources: selected.sources.filter(
                                  (_, at) => at !== index,
                                ),
                              });
                            }}
                          >
                            Удалить источник {index + 1}
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-12"
                        disabled={selected.sources.length >= 100}
                        onClick={() => {
                          edit({
                            ...selected,
                            sources: [
                              ...selected.sources,
                              {
                                sourceId: crypto.randomUUID(),
                                code: `m_${crypto.randomUUID().slice(0, 8)}`,
                                name: "",
                              },
                            ],
                          });
                        }}
                      >
                        Добавить источник
                      </Button>
                    </section>
                  </fieldset>
                  <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
                    <Button type="submit" className="min-h-12" disabled={busy}>
                      Сохранить черновик
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={busy || !dirty}
                      onClick={() => {
                        setSelected(saved);
                        setPreview(null);
                        setFailure(null);
                      }}
                    >
                      Отменить несохранённые правки
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={busy || selected.revision === 0}
                      onClick={() => {
                        reload.mutate({ funnelId: selected.funnelId });
                      }}
                    >
                      Загрузить актуальное состояние
                    </Button>
                  </div>
                </form>
                <section className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
                  <h3 className="text-xl font-semibold">
                    Проверка и публикация
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Добавленные шаги получат и прежние участники. Изменение
                    текста и порядка не повторяет отправленные сообщения.
                    Удаление отменяет ожидающие части после публикации.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    disabled={busy || dirty || selected.revision === 0}
                    onClick={() => {
                      previewMutation.mutate({
                        ...command(),
                        operationId: crypto.randomUUID(),
                      });
                    }}
                  >
                    Проверить изменения и охват
                  </Button>
                  {preview &&
                  preview.funnelId === selected.funnelId &&
                  preview.revision === selected.revision ? (
                    <div className="space-y-4 rounded-xl border border-border bg-background p-4 md:p-5">
                      <h4 className="font-semibold">Что изменится</h4>
                      <ul className="grid gap-3 text-sm sm:grid-cols-2 [&>li]:rounded-lg [&>li]:border [&>li]:border-border [&>li]:bg-card [&>li]:p-4">
                        <li>Новых шагов: {preview.addedStepIds.length}</li>
                        <li>
                          Изменено: {preview.editedStepIds.length}. Повтора
                          отправленных не будет.
                        </li>
                        <li>Удалено: {preview.deletedStepIds.length}</li>
                        <li>Переставлено: {preview.reorderedStepIds.length}</li>
                        <li>Ожидаемый охват: {preview.eligibleContacts}</li>
                        <li>
                          Завершили воронку и получат новые шаги:{" "}
                          {preview.completedParticipantsReceivingNewSteps}
                        </li>
                      </ul>
                      {preview.validationErrors.length +
                        preview.targetErrors.length >
                      0 ? (
                        <div role="alert">
                          <p>
                            Публикация недоступна: проверьте материалы и серии.
                          </p>
                          <ul>
                            {preview.targetErrors.map((error) => (
                              <li key={error.url} className="break-all text-sm">
                                {error.url}:{" "}
                                {
                                  {
                                    not_found: "не найден",
                                    not_published: "снят с публикации",
                                    not_free: "не бесплатный",
                                    incomplete: "не готов",
                                  }[error.reason]
                                }
                              </li>
                            ))}
                            {preview.validationErrors.map((error, index) => (
                              <li key={index} className="break-all text-sm">
                                {error.target.kind} {error.target.targetId}:{" "}
                                {
                                  {
                                    not_found: "не найден",
                                    not_published: "снят с публикации",
                                    not_free: "не бесплатный",
                                    incomplete: "не готов",
                                  }[error.reason]
                                }
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : intro.data?.kind !== "ready" ? (
                        <p role="status">
                          Перед публикацией создайте и сохраните общее
                          знакомство.
                        </p>
                      ) : (
                        <Button
                          type="button"
                          className="min-h-12"
                          disabled={busy || dirty}
                          onClick={() => {
                            const input = command();
                            publish.mutate({
                              ...input,
                              operationId: operationId(["publish", input]),
                            });
                          }}
                        >
                          Опубликовать воронку
                        </Button>
                      )}
                    </div>
                  ) : null}
                </section>
                {selected.publishedRevision !== null ? (
                  <section className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
                    <h3 className="text-xl font-semibold">
                      Управление воронкой
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {(selected.lifecycle === "archived"
                        ? (["restore"] as const)
                        : selected.lifecycle === "paused"
                          ? (["resume", "archive"] as const)
                          : (["pause", "archive"] as const)
                      ).map((action) => (
                        <Button
                          key={action}
                          type="button"
                          variant="outline"
                          className="min-h-12"
                          disabled={busy || dirty}
                          onClick={() => {
                            const input = { ...command(), action };
                            lifecycle.mutate({
                              ...input,
                              operationId: operationId(["lifecycle", input]),
                            });
                          }}
                        >
                          {
                            {
                              pause: "Приостановить",
                              resume: "Возобновить",
                              archive: "Архивировать",
                              restore: "Восстановить на паузе",
                            }[action]
                          }
                        </Button>
                      ))}
                    </div>
                  </section>
                ) : null}
                {selected.revision > 0 ? (
                  <section className="space-y-4 rounded-xl border border-border bg-card p-5 md:p-6">
                    <h3 className="text-xl font-semibold">История доставки</h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={busy || deliveries.isFetching}
                      onClick={() => void deliveries.refetch()}
                    >
                      Обновить историю
                    </Button>
                    {deliveries.isPending ? (
                      <p role="status">Загружаем отправки…</p>
                    ) : deliveries.data?.kind === "error" ? (
                      <p role="alert">{messages[deliveries.data.code]}</p>
                    ) : deliveries.data?.kind === "ready" ? (
                      <>
                        <DeliveryHistory
                          deliveries={deliveries.data.value.deliveries}
                          disabled={busy}
                          onSkip={(input) => {
                            skip.mutate({
                              ...input,
                              operationId: operationId([
                                "skip",
                                input.deliveryId,
                                input.partId,
                                input.expectedRevision,
                              ]),
                            });
                          }}
                          onRetry={(input) => {
                            retry.mutate({
                              ...input,
                              operationId: operationId([
                                "retry",
                                input.deliveryId,
                                input.partId,
                                input.expectedRevision,
                              ]),
                            });
                          }}
                        />
                        {deliveries.data.value.nextCursor ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-12"
                            onClick={() => {
                              if (deliveries.data?.kind === "ready")
                                setDeliveryCursor(
                                  deliveries.data.value.nextCursor ?? undefined,
                                );
                            }}
                          >
                            Следующие отправки
                          </Button>
                        ) : null}
                        {deliveryCursor ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-12"
                            onClick={() => {
                              setDeliveryCursor(undefined);
                            }}
                          >
                            В начало истории
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <p role="alert">Не удалось загрузить отправки.</p>
                    )}
                  </section>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function FunnelStatus({ lifecycle }: { lifecycle: Funnel["lifecycle"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${lifecycle === "published" ? "bg-action" : "bg-muted-foreground"}`}
      />
      {lifecycleLabels[lifecycle]}
    </span>
  );
}
