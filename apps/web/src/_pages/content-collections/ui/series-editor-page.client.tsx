"use client";
import { ArrowLeft, Archive, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SeriesOrderPanel } from "@/features/series-order";
import { ContentCoverEditor } from "@/features/content-covers";
import { Button } from "@/shared/ui/button";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import type { ContentCollection } from "../model/content-collections";
import { useCollectionDraft } from "../model/use-collection-draft.client";
import { MutationNotice } from "./collection-mutation-notice";

export function SeriesEditorPageClient({
  initialCollection,
}: {
  readonly initialCollection: ContentCollection;
}) {
  const router = useRouter();
  const [collection, setCollection] = useState(initialCollection);
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
  } = useCollectionDraft(collection, (result) => {
    if (result.kind === "saved") setCollection(result.collection);
  });
  const back = () => {
    void flushPendingEdits().then((ok) => {
      if (ok) router.push("/authoring/playlists");
    });
  };
  return (
    <main
      className="h-full min-h-svh overflow-y-auto bg-background text-foreground md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-8">
        <nav
          aria-label="Навигация серии"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
        >
          <Button onClick={back} type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" />
            Все серии
          </Button>
          <div className="flex items-center gap-3">
            <span
              className="max-w-36 text-xs text-muted-foreground"
              role="status"
            >
              {autosave.pending
                ? "Сохраняем настройки…"
                : autosave.dirty
                  ? "Настройки не сохранены"
                  : "Настройки сохранены"}
            </span>
            <Button
              disabled={archive.isPending}
              onClick={() => {
                setArchived(!collection.archived);
              }}
              type="button"
              variant="ghost"
            >
              {collection.archived ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Archive aria-hidden="true" />
              )}
              {collection.archived ? "Вернуть из архива" : "В архив"}
            </Button>
          </div>
        </nav>
        <header className="py-8 sm:py-10">
          <h1 className="sr-only">Редактирование серии: {name}</h1>
          <h2 className="sr-only">Настройки серии</h2>
          <form
            aria-label="Настройки серии"
            onSubmit={(event) => {
              event.preventDefault();
              void autosave.retry();
            }}
          >
            <label className="block">
              <span className="text-sm text-muted-foreground">
                Название серии
              </span>
              <textarea
                name="name"
                rows={2}
                className="mt-2 block w-full [field-sizing:content] resize-y rounded-md border border-transparent bg-transparent px-0 py-1 text-3xl font-semibold leading-tight tracking-tight outline-none hover:border-input focus:border-ring focus:ring-2 focus:ring-ring/30 sm:text-4xl"
                required
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
              />
            </label>
            <div className="mt-4 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
              <label className="block">
                <span className="text-sm text-muted-foreground">
                  Краткое описание
                </span>
                <textarea
                  name="summary"
                  rows={3}
                  className="mt-2 block min-h-24 w-full resize-y rounded-md border border-transparent bg-transparent px-0 py-1 text-base leading-relaxed outline-none hover:border-input focus:border-ring focus:ring-2 focus:ring-ring/30"
                  maxLength={500}
                  placeholder="Какую задачу помогает решить эта серия?"
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.currentTarget.value);
                  }}
                />
                <span className="mt-2 block break-all text-xs text-muted-foreground">
                  Адрес: /series/{collection.slug}
                </span>
              </label>
              <ContentCoverEditor
                initialCover={cover}
                onChange={setCover}
                ownerId={collection.id}
                ownerKind="series"
                ownerLabel={name}
              />
            </div>
            {autosave.error ? (
              <Button className="mt-4" type="submit" variant="outline">
                Повторить сохранение
              </Button>
            ) : null}
          </form>
          <MutationNotice
            onRefresh={() => {
              window.location.reload();
            }}
            result={
              autosave.error
                ? (update.data ?? null)
                : archive.data?.kind === "saved"
                  ? null
                  : (archive.data ?? null)
            }
          />
        </header>
        <SeriesOrderPanel
          seriesId={collection.id}
          archived={collection.archived}
        />
      </div>
    </main>
  );
}
