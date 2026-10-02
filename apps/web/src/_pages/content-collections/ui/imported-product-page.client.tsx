"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ContentCoverEditor } from "@/features/content-covers";
import { GuideArtifactsPanel } from "@/features/guide-artifacts";
import { HomeSeriesPin, SeriesOrderPanel } from "@/features/series-order";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

import type { ContentCollection } from "../model/content-collections";
import { GUIDE_INTRODUCTION_FIELDS } from "../model/guide-introduction-fields";
import { SeriesEditorPageFrame } from "./series-editor-page-frame";

/**
 * Страница продукта, перенесённого из источника (#844). Название, описание, блок «О продукте» и
 * состав показаны текстом, а действия архива нет: их запись из редактора backend отклоняет.
 * Обложку, закреп на главной и артефакты редактор меняет и у такого продукта.
 */
export function ImportedProductPage({
  collection,
}: {
  readonly collection: ContentCollection;
}) {
  const router = useRouter();
  const [cover, setCover] = useState(collection.cover ?? null);
  const summary = collection.summary.trim();
  const introduction = GUIDE_INTRODUCTION_FIELDS.flatMap(({ field, label }) => {
    const text = collection.introduction?.[field].trim();
    return hasText(text) ? [{ field, label, text }] : [];
  });
  return (
    <SeriesEditorPageFrame>
      <nav
        aria-label="Навигация продукта"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
      >
        <Button
          onClick={() => {
            // Загрузка обложки ещё может идти: уход дожидается её так же, как у обычного продукта.
            void flushPendingEdits().then((ok) => {
              if (ok) router.push("/authoring/guides");
            });
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
          Все продукты
        </Button>
        {collection.archived ? (
          <span className="text-sm text-muted-foreground">В архиве</span>
        ) : null}
      </nav>
      <header className="py-8 sm:py-10">
        <h1 className="sr-only">Продукт из источника: {collection.name}</h1>
        <h2 className="sr-only">Настройки продукта</h2>
        <p className="rounded-xl bg-muted p-4 text-sm leading-6" role="note">
          <span className="font-semibold">Продукт перенесён из источника.</span>{" "}
          Название, описание, блок «О продукте» и состав меняются только
          переносом из источника. Отправить такой продукт в архив или вернуть из
          архива в редакторе нельзя.
        </p>
        <dl className="mt-6">
          <dt className="text-sm text-muted-foreground">Название продукта</dt>
          <dd className="mt-2 text-3xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-4xl">
            {collection.name}
          </dd>
        </dl>
        <div className="mt-4 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {hasText(summary) ? (
              <dl>
                <dt className="text-sm text-muted-foreground">
                  Краткое описание
                </dt>
                <dd className="mt-2 whitespace-pre-line text-base leading-relaxed [overflow-wrap:anywhere]">
                  {summary}
                </dd>
              </dl>
            ) : null}
            <p className="mt-2 break-all text-xs text-muted-foreground">
              Адрес: /products/{collection.slug}
            </p>
          </div>
          <ContentCoverEditor
            initialCover={cover}
            onChange={setCover}
            ownerId={collection.id}
            ownerKind="series"
            ownerLabel={collection.name}
          />
        </div>
        {introduction.length === 0 ? null : (
          <section aria-labelledby="imported-introduction" className="mt-8">
            <h3 className="text-sm font-semibold" id="imported-introduction">
              О продукте для читателя
            </h3>
            <dl className="mt-4 grid gap-6 sm:grid-cols-2">
              {introduction.map(({ field, label, text }) => (
                <div className="min-w-0" key={field}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-2 whitespace-pre-line text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {text}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </header>
      <HomeSeriesPin seriesId={collection.id} archived={collection.archived} />
      <SeriesOrderPanel
        seriesId={collection.id}
        archived={collection.archived}
        readOnly
      />
      <GuideArtifactsPanel
        archived={collection.archived}
        guideId={collection.id}
      />
    </SeriesEditorPageFrame>
  );
}
