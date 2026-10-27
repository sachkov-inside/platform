"use client";
import { Archive, RotateCcw } from "lucide-react";
import { useState } from "react";
import { ProductArtifactsPanel } from "@/features/product-artifacts";
import { ProductEditorPageFrame } from "./product-editor-page-frame";
import { HomeProductPin, ProductOrderPanel } from "@/features/product-order";
import { ContentCoverEditor } from "@/features/content-covers";
import { Button } from "@/shared/ui/button";
import { hasText } from "@/shared/lib/text";
import {
  PRODUCT_INTRODUCTION_FIELD_MAX,
  type ContentCollection,
} from "../model/content-collections";
import { PRODUCT_INTRODUCTION_FIELDS } from "../model/product-introduction-fields";
import { useCollectionDraft } from "../model/use-collection-draft.client";
import { MutationNotice } from "./collection-mutation-notice";
import { ImportedProductPage } from "./imported-product-page";
import { ProductPageNavigation } from "./product-page-navigation.client";
import { ProductCommunityTab } from "./product-community-tab";
import { ProductLearnersTab } from "./product-learners-tab";
import { ProductPageTabs } from "./product-page-tabs.client";
import { ProductSaleTab } from "./product-sale-tab";

/**
 * Продукт, перенесённый из источника, backend из редактора не меняет: ни настройки, ни состав, ни
 * архив. Такой продукт открывается страницей для чтения, без автосохранения, поэтому отказ и тупик
 * после него не возникают (#844).
 */
export function ProductEditorPageClient({
  initialCollection,
}: {
  readonly initialCollection: ContentCollection;
}) {
  return hasText(initialCollection.sourceId) ? (
    <ImportedProductPage collection={initialCollection} />
  ) : (
    <AuthoredProductEditor initialCollection={initialCollection} />
  );
}

function AuthoredProductEditor({
  initialCollection,
}: {
  readonly initialCollection: ContentCollection;
}) {
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
  return (
    <ProductEditorPageFrame>
      <ProductPageNavigation>
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
      </ProductPageNavigation>
      <header className="authoring-page-heading">
        <h1>{name}</h1>
        <p>Программа, витрина, продажа и ученики продукта.</p>
      </header>
      <ProductPageTabs
        panels={{
          program: (
            <>
              <ProductOrderPanel
                productId={collection.id}
                archived={collection.archived}
              />
              <ProductArtifactsPanel
                archived={collection.archived}
                productId={collection.id}
              />
            </>
          ),
          description: (
            <section
              className="authoring-product-description"
              aria-label="Описание продукта"
            >
              <h2 className="mb-5 text-lg font-semibold">Описание продукта</h2>

              <form
                aria-label="Настройки продукта"
                onSubmit={(event) => {
                  event.preventDefault();
                  void autosave.retry();
                }}
              >
                <label className="block">
                  <span className="text-sm text-muted-foreground">
                    Название продукта
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
                      placeholder="Какую задачу помогает решить этот продукт?"
                      value={summary}
                      onChange={(event) => {
                        setSummary(event.currentTarget.value);
                      }}
                    />
                    <span className="mt-2 block break-all text-xs text-muted-foreground">
                      Адрес: /products/{collection.slug}
                    </span>
                  </label>
                  <ContentCoverEditor
                    initialCover={cover}
                    onChange={setCover}
                    ownerId={collection.id}
                    ownerKind="product"
                    ownerLabel={name}
                  />
                </div>
                <fieldset className="mt-8 grid gap-6 border-0 p-0 sm:grid-cols-2">
                  <legend className="mb-4 block text-sm font-semibold">
                    О продукте для читателя
                  </legend>
                  {PRODUCT_INTRODUCTION_FIELDS.map(
                    ({ field, label, placeholder }) => (
                      <label className="block" key={field}>
                        <span className="text-sm text-muted-foreground">
                          {label}
                        </span>
                        <textarea
                          className="mt-2 block min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                          maxLength={PRODUCT_INTRODUCTION_FIELD_MAX}
                          name={field}
                          onChange={(event) => {
                            editIntroduction(field, event.currentTarget.value);
                          }}
                          placeholder={placeholder}
                          rows={4}
                          value={introduction[field]}
                        />
                      </label>
                    ),
                  )}
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
              <HomeProductPin
                productId={collection.id}
                archived={collection.archived}
              />
            </section>
          ),
          sale: (
            <ProductSaleTab
              archived={collection.archived}
              productId={collection.id}
              productName={collection.name}
            />
          ),
          learners: <ProductLearnersTab productId={collection.id} />,
          community: (
            <ProductCommunityTab
              productId={collection.id}
              productName={collection.name}
            />
          ),
        }}
      />
    </ProductEditorPageFrame>
  );
}
