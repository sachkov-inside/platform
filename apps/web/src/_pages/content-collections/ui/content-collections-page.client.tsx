"use client";

import {
  Archive,
  ChevronDown,
  LoaderCircle,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { SeriesOrderPanel } from "@/features/series-order";
import { ContentCoverImage } from "@/entities/material";
import {
  flushPendingEdits,
  useAutosave,
} from "@/shared/lib/autosave/use-autosave";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { ContentCoverEditor } from "@/features/content-covers";

import {
  createContentCollection,
  setContentCollectionArchive,
  updateContentCollection,
} from "../api/content-collections.browser";
import type {
  ContentCollection,
  ContentCollectionKind,
  ContentCollectionMutationResult,
  UpdateContentCollectionInput,
} from "../model/content-collections";

export function ContentCollectionsPageClient({
  initialCollections,
  kind,
}: {
  readonly initialCollections: readonly ContentCollection[];
  readonly kind: ContentCollectionKind;
}) {
  const router = useRouter();
  const [collections, setCollections] = useState(initialCollections);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const applySavedCollection = (result: ContentCollectionMutationResult) => {
    if (result.kind !== "saved") return;
    setCollections((current) => {
      const existing = current.some(({ id }) => id === result.collection.id);
      const next = existing
        ? current.map((collection) =>
            collection.id === result.collection.id
              ? result.collection
              : collection,
          )
        : [...current, result.collection];
      return [...next].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    });
  };
  const createMutation = useMutation({
    mutationFn: createContentCollection,
    onSuccess: (result) => {
      applySavedCollection(result);
      if (result.kind === "saved") {
        setName("");
        setSlug("");
        setSummary("");
        setCreateOpen(false);
      }
    },
  });
  const pending = createMutation.isPending;
  const refreshCollections = () => {
    router.refresh();
  };
  const noun = kind === "topic" ? "тему" : "руководство";
  const plural = kind === "topic" ? "Темы" : "Руководства";

  return (
    <main
      className="h-full min-h-svh overflow-y-auto bg-background px-4 pb-20 pt-5 text-foreground sm:px-6 md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
          <h1 className="text-3xl font-semibold tracking-tight">
            {plural}{" "}
            <span className="text-base font-normal text-muted-foreground">
              {collections.length}
            </span>
          </h1>
          <Button
            aria-label={`Создать ${noun}`}
            onClick={() => {
              setCreateOpen(!createOpen);
            }}
            type="button"
          >
            <Plus />
            {kind === "topic" ? "Создать тему" : "Создать"}
          </Button>
        </header>
        {createOpen ? (
          <section
            aria-label={`Создать ${noun}`}
            className="mt-6 rounded-2xl border border-border bg-card p-5"
          >
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate({ kind, name, slug, summary });
              }}
            >
              <Field label="Название">
                <input
                  className={fieldClassName}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                  }}
                  required
                  value={name}
                />
              </Field>
              <Field hint="После создания не меняется" label="Адрес">
                <input
                  className={fieldClassName}
                  maxLength={120}
                  onChange={(event) => {
                    setSlug(event.currentTarget.value);
                  }}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="platform-engineering"
                  required
                  value={slug}
                />
              </Field>
              <Field className="sm:col-span-2" label="Краткое описание">
                <textarea
                  className={`${fieldClassName} min-h-20 py-3`}
                  maxLength={500}
                  onChange={(event) => {
                    setSummary(event.currentTarget.value);
                  }}
                  value={summary}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button disabled={pending} type="submit">
                  {createMutation.isPending ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  Создать
                </Button>
              </div>
            </form>
            <MutationNotice
              onRefresh={refreshCollections}
              result={createMutation.data ?? null}
            />
          </section>
        ) : null}

        <section aria-labelledby="collection-list" className="mt-9">
          <div className="flex items-end justify-between gap-4">
            <h2
              className="text-xl font-semibold tracking-[-0.025em]"
              id="collection-list"
            >
              Все {plural.toLocaleLowerCase("ru")}
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              {String(collections.length)}
            </span>
          </div>
          {collections.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
              <p className="font-semibold">Пока ничего нет</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Нажмите «Создать», чтобы добавить первую запись.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {collections.map((collection) => (
                <CollectionEditor
                  collection={collection}
                  key={collection.id}
                  onSaved={applySavedCollection}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CollectionEditor({
  collection,
  onSaved,
}: {
  readonly collection: ContentCollection;
  readonly onSaved: (result: ContentCollectionMutationResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [compositionOpen, setCompositionOpen] = useState(false);
  const [name, setName] = useState(collection.name);
  const [summary, setSummary] = useState(collection.summary);
  const [cover, setCover] = useState(collection.cover ?? null);
  const version = useRef(collection.version);
  const attempted = useRef<UpdateContentCollectionInput | null>(null);
  const update = useMutation({ mutationFn: updateContentCollection });
  const archive = useMutation({
    mutationFn: setContentCollectionArchive,
    onSuccess: (result) => {
      if (result.kind === "saved") version.current = result.collection.version;
      onSaved(result);
    },
  });
  const autosave = useAutosave({
    value: { name, summary },
    enabled: name.trim().length > 0,
    save: async (value) => {
      const input = attempted.current ?? {
        ...value,
        collectionId: collection.id,
        expectedVersion: version.current,
        kind: collection.kind,
      };
      attempted.current = input;
      const result = await update.mutateAsync(input);
      if (result.kind === "saved") {
        version.current = result.collection.version;
        attempted.current = null;
        onSaved(result);
        return "saved";
      }
      if (result.kind === "invalid") {
        attempted.current = null;
        return "invalid";
      }
      return "failed";
    },
  });
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card",
        collection.archived && "bg-muted/20",
      )}
    >
      <button
        className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/30"
        aria-expanded={open}
        onClick={() => {
          if (!open) setOpen(true);
          else
            void flushPendingEdits().then((ok) => {
              if (ok) setOpen(false);
            });
        }}
        type="button"
      >
        <ContentCoverImage
          alt=""
          cover={cover}
          className="aspect-video w-20 shrink-0 rounded-lg"
          sizes="5rem"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            /{collection.slug} · {formatCount(collection.materialCount)}
            {collection.archived ? " · Архив" : ""}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="border-t border-border p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название">
              <input
                className={fieldClassName}
                maxLength={120}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                required
                value={name}
              />
            </Field>
            <Field label="Краткое описание">
              <textarea
                className={`${fieldClassName} min-h-20 py-2`}
                maxLength={500}
                onChange={(event) => {
                  setSummary(event.currentTarget.value);
                }}
                value={summary}
              />
            </Field>
            <ContentCoverEditor
              initialCover={cover}
              onChange={setCover}
              ownerId={collection.id}
              ownerKind={collection.kind}
              ownerLabel={name}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className="mr-auto text-xs text-muted-foreground"
              role="status"
            >
              {autosave.pending
                ? "Сохранение…"
                : autosave.dirty
                  ? "Не сохранено"
                  : "Сохранено"}
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
            {collection.kind === "series" ? (
              <Button
                onClick={() => {
                  if (!compositionOpen) setCompositionOpen(true);
                  else
                    void flushPendingEdits().then((ok) => {
                      if (ok) setCompositionOpen(false);
                    });
                }}
                type="button"
                variant="outline"
                aria-expanded={compositionOpen}
              >
                Материалы руководства
              </Button>
            ) : null}
            <Button
              disabled={archive.isPending}
              onClick={() => {
                void autosave.flush().then((ok) => {
                  if (ok)
                    archive.mutate({
                      archived: !collection.archived,
                      collectionId: collection.id,
                      expectedVersion: version.current,
                      kind: collection.kind,
                    });
                });
              }}
              type="button"
              variant="ghost"
            >
              {collection.archived ? <RotateCcw /> : <Archive />}
              {collection.archived ? "Вернуть" : "В архив"}
            </Button>
          </div>
          <MutationNotice
            onRefresh={() => {
              window.location.reload();
            }}
            result={
              autosave.error ? (update.data ?? null) : (archive.data ?? null)
            }
          />
          {compositionOpen ? (
            <div className="mt-5 border-t border-border">
              <SeriesOrderPanel
                seriesId={collection.id}
                onClose={() => {
                  setCompositionOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Field({
  children,
  className,
  hint,
  label,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly hint?: string;
  readonly label: string;
}) {
  return (
    <label className={className}>
      <span className="text-sm font-semibold">{label}</span>
      {hint === undefined ? null : (
        <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
      )}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function MutationNotice({
  onRefresh,
  result,
}: {
  readonly onRefresh: () => void;
  readonly result: ContentCollectionMutationResult | null;
}) {
  if (result === null) return null;
  if (result.kind === "saved")
    return (
      <p className="mt-4 text-sm font-semibold" role="status">
        Изменения сохранены.
      </p>
    );
  if (result.kind === "conflict") {
    return (
      <div className="mt-4 rounded-xl bg-muted p-4 text-sm" role="alert">
        <p className="font-semibold">Запись изменилась в другой вкладке.</p>
        <Button
          className="mt-3"
          onClick={onRefresh}
          size="sm"
          type="button"
          variant="outline"
        >
          Загрузить актуальную версию
        </Button>
      </div>
    );
  }
  const message =
    result.kind === "slug_conflict"
      ? "Такой slug уже занят. Выберите другой."
      : result.kind === "invalid"
        ? "Проверьте название, slug и длину описания."
        : result.kind === "unauthorized"
          ? "Сессия завершилась или права изменились."
          : `Не удалось сохранить. Код: ${result.reference}`;
  return (
    <p className="mt-4 rounded-xl bg-destructive/6 p-4 text-sm" role="alert">
      {message}
    </p>
  );
}

const fieldClassName =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

function formatCount(count: number): string {
  return `${String(count)} ${count === 1 ? "материал" : "материалов"}`;
}
