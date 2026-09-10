"use client";
import { ArrowLeft, Archive, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GuideArtifactsPanel } from "@/features/guide-artifacts";
import { HomeSeriesPin, SeriesOrderPanel } from "@/features/series-order";
import { ContentCoverEditor } from "@/features/content-covers";
import { Button } from "@/shared/ui/button";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import {
  GUIDE_INTRODUCTION_FIELD_MAX,
  type ContentCollection,
  type GuideIntroductionDraft,
} from "../model/content-collections";

/** Reader-facing wording; the field names follow the Inside Content `guide.yaml`. */
const INTRODUCTION_FIELDS: readonly {
  readonly field: keyof GuideIntroductionDraft;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  {
    field: "outcome",
    label: "Что читатель сможет",
    placeholder: "Какую задачу читатель решит после полного руководства?",
  },
  {
    field: "audience",
    label: "Для кого",
    placeholder: "Кому это руководство полезно?",
  },
  {
    field: "prerequisites",
    label: "Что нужно знать заранее",
    placeholder: "Какие знания и опыт нужны до начала?",
  },
  {
    field: "scope",
    label: "Что разбираем и что остаётся за границами",
    placeholder: "Что входит в руководство, а что нет и что ещё готовится?",
  },
];
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
    introduction,
    editIntroduction,
    cover,
    setCover,
    setArchived,
    update,
    archive,
    autosave,
  } = useCollectionDraft(
    collection,
    (result) => {
      if (result.kind === "saved") setCollection(result.collection);
    },
    { editsIntroduction: true },
  );
  const back = () => {
    void flushPendingEdits().then((ok) => {
      if (ok) router.push("/authoring/guides");
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
          aria-label="Навигация руководства"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
        >
          <Button onClick={back} type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" />
            Все руководства
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
          <h1 className="sr-only">Редактирование руководства: {name}</h1>
          <h2 className="sr-only">Настройки руководства</h2>
          <form
            aria-label="Настройки руководства"
            onSubmit={(event) => {
              event.preventDefault();
              void autosave.retry();
            }}
          >
            <label className="block">
              <span className="text-sm text-muted-foreground">
                Название руководства
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
                  placeholder="Какую задачу помогает решить это руководство?"
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.currentTarget.value);
                  }}
                />
                <span className="mt-2 block break-all text-xs text-muted-foreground">
                  Адрес: /guides/{collection.slug}
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
            <fieldset className="mt-8 grid gap-6 border-0 p-0 sm:grid-cols-2">
              <legend className="mb-4 block text-sm font-semibold">
                О руководстве для читателя
              </legend>
              {INTRODUCTION_FIELDS.map(({ field, label, placeholder }) => (
                <label className="block" key={field}>
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <textarea
                    className="mt-2 block min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    maxLength={GUIDE_INTRODUCTION_FIELD_MAX}
                    name={field}
                    onChange={(event) => {
                      editIntroduction(field, event.currentTarget.value);
                    }}
                    placeholder={placeholder}
                    rows={4}
                    value={introduction[field]}
                  />
                </label>
              ))}
            </fieldset>
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
        <HomeSeriesPin seriesId={collection.id} archived={collection.archived} />
        <SeriesOrderPanel
          seriesId={collection.id}
          archived={collection.archived}
        />
        <GuideArtifactsPanel
          archived={collection.archived}
          guideId={collection.id}
        />
      </div>
    </main>
  );
}
