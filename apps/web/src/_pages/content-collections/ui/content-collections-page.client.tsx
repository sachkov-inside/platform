"use client";

import { Archive, Check, ExternalLink, LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  SetContentCollectionArchiveInput,
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
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const applySavedCollection = (result: ContentCollectionMutationResult) => {
    if (result.kind !== "saved") return;
    setCollections((current) => {
      const existing = current.some(({ id }) => id === result.collection.id);
      const next = existing
        ? current.map((collection) =>
            collection.id === result.collection.id ? result.collection : collection,
          )
        : [...current, result.collection];
      return [...next].sort((left, right) => left.name.localeCompare(right.name));
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
      }
    },
  });
  const updateMutation = useMutation({
    mutationFn: updateContentCollection,
    onSuccess: applySavedCollection,
  });
  const archiveMutation = useMutation({
    mutationFn: setContentCollectionArchive,
    onSuccess: applySavedCollection,
  });
  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    archiveMutation.isPending;
  const refreshCollections = () => {
    updateMutation.reset();
    archiveMutation.reset();
    router.refresh();
  };
  const noun = kind === "topic" ? "тему" : "плейлист";
  const plural = kind === "topic" ? "Темы" : "Плейлисты";

  return (
    <main className="h-full min-h-svh overflow-y-auto bg-background px-4 pb-20 pt-5 text-foreground sm:px-6 md:min-h-0" id="authoring-content" tabIndex={-1}>
      <div className="mx-auto w-full max-w-5xl">
        <header className="border-b border-border pb-6">
          <p className="font-mono text-xs text-muted-foreground">Структура Базы знаний</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{plural}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Создавайте и редактируйте записи. Адрес фиксируется после создания, а архив сохраняет существующие ссылки.
          </p>
        </header>

        <section aria-labelledby="create-collection" className="mt-6 rounded-2xl bg-card p-4 shadow-card sm:p-5">
          <h2 className="text-xl font-semibold tracking-[-0.025em]" id="create-collection">
            Создать {noun}
          </h2>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate({ kind, name, slug, summary });
            }}
          >
            <Field label="Название">
              <input className={fieldClassName} maxLength={120} onChange={(event) => { setName(event.currentTarget.value); }} required value={name} />
            </Field>
            <Field hint="После создания не меняется" label="Slug">
              <input className={fieldClassName} maxLength={120} onChange={(event) => { setSlug(event.currentTarget.value); }} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="platform-engineering" required value={slug} />
            </Field>
            <Field className="sm:col-span-2" label="Краткое описание">
              <textarea className={`${fieldClassName} min-h-20 py-3`} maxLength={500} onChange={(event) => { setSummary(event.currentTarget.value); }} value={summary} />
            </Field>
            <div className="sm:col-span-2">
              <Button disabled={pending} type="submit">
                {createMutation.isPending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
                Создать
              </Button>
            </div>
          </form>
          <MutationNotice onRefresh={refreshCollections} result={createMutation.data ?? null} />
        </section>

        <section aria-labelledby="collection-list" className="mt-9">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-[-0.025em]" id="collection-list">Все {plural.toLocaleLowerCase("ru")}</h2>
            <span className="font-mono text-xs text-muted-foreground">{String(collections.length)}</span>
          </div>
          {collections.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
              <p className="font-semibold">Пока ничего нет</p>
              <p className="mt-2 text-sm text-muted-foreground">Создайте первую запись формой выше.</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {collections.map((collection) => (
                <CollectionEditor
                  collection={collection}
                  disabled={pending}
                  key={`${collection.id}-${String(collection.version)}`}
                  onArchive={(input) => { archiveMutation.mutate(input); }}
                  onUpdate={(input) => { updateMutation.mutate(input); }}
                />
              ))}
            </div>
          )}
          <MutationNotice onRefresh={refreshCollections} result={updateMutation.data ?? null} />
          <MutationNotice onRefresh={refreshCollections} result={archiveMutation.data ?? null} />
        </section>
      </div>
    </main>
  );
}

function CollectionEditor({
  collection,
  disabled,
  onArchive,
  onUpdate,
}: {
  readonly collection: ContentCollection;
  readonly disabled: boolean;
  readonly onArchive: (input: SetContentCollectionArchiveInput) => void;
  readonly onUpdate: (input: UpdateContentCollectionInput) => void;
}) {
  const [name, setName] = useState(collection.name);
  const [summary, setSummary] = useState(collection.summary);
  const dirty = name.trim() !== collection.name || summary.trim() !== collection.summary;
  return (
    <article className={cn("rounded-2xl border border-border bg-card p-4 sm:p-5", collection.archived && "bg-muted/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs text-muted-foreground">/{collection.slug}</code>
            {collection.archived ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">В архиве</span> : null}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{formatCount(collection.materialCount)}</p>
        </div>
        {collection.kind === "series" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/authoring/playlists/${collection.id}`}>
              Состав
              <ExternalLink aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="mt-4 max-w-md">
        <ContentCoverEditor
          disabled={disabled}
          initialCover={collection.cover ?? null}
          ownerId={collection.id}
          ownerKind={collection.kind}
          ownerLabel={collection.name}
        />
      </div>
      <form
        className="mt-4 grid gap-3 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onUpdate({
            collectionId: collection.id,
            expectedVersion: collection.version,
            kind: collection.kind,
            name,
            summary,
          });
        }}
      >
        <Field label="Название">
          <input className={fieldClassName} disabled={disabled} maxLength={120} onChange={(event) => { setName(event.currentTarget.value); }} required value={name} />
        </Field>
        <Field label="Краткое описание">
          <textarea className={`${fieldClassName} min-h-16 py-3`} disabled={disabled} maxLength={500} onChange={(event) => { setSummary(event.currentTarget.value); }} value={summary} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
          <Button disabled={disabled || !dirty} type="submit">
            <Check aria-hidden="true" />
            Сохранить
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              onArchive({
                archived: !collection.archived,
                collectionId: collection.id,
                expectedVersion: collection.version,
                kind: collection.kind,
              });
            }}
            type="button"
            variant="outline"
          >
            {collection.archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}
            {collection.archived ? "Вернуть из архива" : "Архивировать"}
          </Button>
        </div>
      </form>
    </article>
  );
}

function Field({ children, className, hint, label }: { readonly children: React.ReactNode; readonly className?: string; readonly hint?: string; readonly label: string }) {
  return (
    <label className={className}>
      <span className="text-sm font-semibold">{label}</span>
      {hint === undefined ? null : <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function MutationNotice({ onRefresh, result }: { readonly onRefresh: () => void; readonly result: ContentCollectionMutationResult | null }) {
  if (result === null) return null;
  if (result.kind === "saved") return <p className="mt-4 text-sm font-semibold" role="status">Изменения сохранены.</p>;
  if (result.kind === "conflict") {
    return (
      <div className="mt-4 rounded-xl bg-muted p-4 text-sm" role="alert">
        <p className="font-semibold">Запись изменилась в другой вкладке.</p>
        <Button className="mt-3" onClick={onRefresh} size="sm" type="button" variant="outline">Загрузить актуальную версию</Button>
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
  return <p className="mt-4 rounded-xl bg-destructive/6 p-4 text-sm" role="alert">{message}</p>;
}

const fieldClassName = "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

function formatCount(count: number): string {
  return `${String(count)} ${count === 1 ? "материал" : "материалов"}`;
}
