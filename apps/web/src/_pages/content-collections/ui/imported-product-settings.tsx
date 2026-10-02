import type { ContentCover } from "@/entities/material.model";
import { ContentCoverEditor } from "@/features/content-covers";
import { hasText } from "@/shared/lib/text";

import type { ContentCollection } from "../model/content-collections";
import { GUIDE_INTRODUCTION_FIELDS } from "../model/guide-introduction-fields";

/**
 * Настройки продукта, перенесённого из источника (#844). Backend отклоняет запись его названия,
 * описания и блока «О продукте» из редактора, поэтому они показаны текстом, без полей правки.
 * Обложку редактор меняет и у такого продукта.
 */
export function ImportedProductSettings({
  collection,
  cover,
  onCoverChange,
}: {
  readonly collection: ContentCollection;
  readonly cover: ContentCover | null;
  readonly onCoverChange: (cover: ContentCover | null) => void;
}) {
  const introduction = GUIDE_INTRODUCTION_FIELDS.flatMap(({ field, label }) => {
    const text = collection.introduction?.[field].trim();
    return hasText(text) ? [{ field, label, text }] : [];
  });
  return (
    <>
      <p className="rounded-xl bg-muted p-4 text-sm leading-6" role="note">
        <span className="font-semibold">Продукт перенесён из источника.</span>{" "}
        Название, описание, блок «О продукте», состав и архив меняются только
        переносом из источника.
      </p>
      <dl className="mt-6">
        <dt className="text-sm text-muted-foreground">Название продукта</dt>
        <dd className="mt-2 text-3xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-4xl">
          {collection.name}
        </dd>
      </dl>
      <div className="mt-4 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {hasText(collection.summary.trim()) ? (
            <dl>
              <dt className="text-sm text-muted-foreground">
                Краткое описание
              </dt>
              <dd className="mt-2 whitespace-pre-line text-base leading-relaxed [overflow-wrap:anywhere]">
                {collection.summary}
              </dd>
            </dl>
          ) : null}
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Адрес: /products/{collection.slug}
          </p>
        </div>
        <ContentCoverEditor
          initialCover={cover}
          onChange={onCoverChange}
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
    </>
  );
}
