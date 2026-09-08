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
import { useState } from "react";

import { useHomePin, HomeSeriesPinButton } from "@/features/series-order";
import Link from "next/link";
import { formatMaterialCount } from "@/features/library-discovery";
import { MutationNotice } from "./collection-mutation-notice";
import { useCollectionDraft } from "../model/use-collection-draft.client";
import { ContentCoverImage } from "@/entities/material";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { ContentCoverEditor } from "@/features/content-covers";

import { createContentCollection } from "../api/content-collections.browser";
import type {
  ContentCollection,
  ContentCollectionKind,
  ContentCollectionMutationResult,
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
        if (kind === "series")
          router.push(`/authoring/playlists/${result.collection.id}`);
      }
    },
  });
  const pending = createMutation.isPending;
  const refreshCollections = () => {
    router.refresh();
  };
  const noun = kind === "topic" ? "тему" : "серию";
  const plural = kind === "topic" ? "Темы" : "Серии";

  return (
    <main
      className="h-full min-h-svh overflow-y-auto bg-background px-4 pb-20 pt-5 text-foreground sm:px-6 md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-4 border-b border-border py-4">
          <h1 className="text-3xl font-semibold tracking-tight">
            {plural}{" "}
            <span className="text-base font-normal text-muted-foreground">
              {collections.length}
            </span>
          </h1>
          <Button
            onClick={() => {
              setCreateOpen(!createOpen);
            }}
            type="button"
          >
            <Plus />
            Создать {noun}
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
          ) : kind === "series" ? (
            <SeriesList collections={collections} />
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
  const {
    name,
    setName,
    summary,
    setSummary,
    cover,
    setCover,
    setArchived,
    update,
    archive,
    autosave,
  } = useCollectionDraft(collection, onSaved);
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
            /{collection.slug} · {formatMaterialCount(collection.materialCount)}
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
            <Button
              disabled={archive.isPending}
              onClick={() => {
                setArchived(!collection.archived);
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

const fieldClassName =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

function SeriesList({
  collections,
}: {
  readonly collections: readonly ContentCollection[];
}) {
  const { controls, hasError, message, retry } = useHomePin();
  return (
    <>
      <div
        className="mt-3 grid min-h-28 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm text-muted-foreground sm:min-h-16"
        role={hasError ? "alert" : "status"}
      >
        <p>
          {hasError
            ? message
            : "Закрепите серию значком справа — она появится первой на главной."}
        </p>
        <Button
          className={
            hasError
              ? "max-w-28 whitespace-normal"
              : "invisible max-w-28 whitespace-normal"
          }
          disabled={!hasError}
          onClick={retry}
          type="button"
          variant="outline"
          size="sm"
        >
          Обновить закреп
        </Button>
      </div>
      <ul
        className="mt-2 divide-y divide-border border-y border-border"
        aria-label="Все серии"
      >
        {collections.map((collection) => {
          const pinned = controls.pin?.seriesId === collection.id;
          return (
            <li
              className="flex items-center gap-3 py-4 sm:gap-5"
              key={collection.id}
            >
              <Link
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-5"
                href={`/authoring/playlists/${collection.id}`}
              >
                <ContentCoverImage
                  alt=""
                  cover={collection.cover ?? null}
                  className="aspect-video w-20 shrink-0 rounded-lg sm:w-28"
                  sizes="7rem"
                />
                <span className="min-w-0">
                  <span className="block text-base font-semibold leading-snug group-hover:underline sm:text-lg">
                    {collection.name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-sm">
                    <span>{formatMaterialCount(collection.materialCount)}</span>
                    {collection.archived ? <span>Архив</span> : null}
                    {pinned ? (
                      <span className="font-medium text-action">
                        На главной
                      </span>
                    ) : null}
                  </span>
                </span>
              </Link>
              <HomeSeriesPinButton
                seriesId={collection.id}
                seriesName={collection.name}
                archived={collection.archived}
                controls={controls}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
