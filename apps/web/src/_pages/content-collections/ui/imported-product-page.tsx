import { ContentCoverEditor } from "@/features/content-covers";
import { ProductArtifactsPanel } from "@/features/product-artifacts";
import { HomeProductPin, ProductOrderPanel } from "@/features/product-order";
import { hasText } from "@/shared/lib/text";

import type { ContentCollection } from "../model/content-collections";
import { PRODUCT_INTRODUCTION_FIELDS } from "../model/product-introduction-fields";
import { ProductPageNavigation } from "./product-page-navigation.client";
import { ProductCommunityTab } from "./product-community-tab";
import { ProductLearnersTab } from "./product-learners-tab";
import { ProductOverviewTab } from "./product-overview-tab";
import { ProductPageTabs } from "./product-page-tabs.client";
import { ProductSaleTab } from "./product-sale-tab";
import { ProductEditorPageFrame } from "./product-editor-page-frame";

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
  const summary = collection.summary.trim();
  const introduction = PRODUCT_INTRODUCTION_FIELDS.flatMap(
    ({ field, label }) => {
      const text = collection.introduction?.[field].trim();
      return hasText(text) ? [{ field, label, text }] : [];
    },
  );
  return (
    <ProductEditorPageFrame>
      <ProductPageNavigation>
        {collection.archived ? (
          <span className="text-sm text-muted-foreground">В архиве</span>
        ) : null}
      </ProductPageNavigation>
      <header className="authoring-page-heading">
        <h1>{collection.name}</h1>
        <p>Обзор, программа, витрина, продажа и ученики продукта.</p>
      </header>
      <ProductPageTabs
        panels={{
          overview: <ProductOverviewTab productId={collection.id} />,
          program: (
            <>
              <ProductOrderPanel
                productId={collection.id}
                archived={collection.archived}
                readOnly
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

              <p
                className="rounded-xl bg-muted p-4 text-sm leading-6"
                role="note"
              >
                <span className="font-semibold">
                  Продукт перенесён из источника.
                </span>{" "}
                Название, описание и состав меняются только переносом из
                источника. Блок «О продукте» и архив такого продукта в редакторе
                не меняются.
              </p>
              <dl className="mt-6">
                <dt className="text-sm text-muted-foreground">
                  Название продукта
                </dt>
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
                  initialCover={collection.cover ?? null}
                  ownerId={collection.id}
                  ownerKind="product"
                  ownerLabel={collection.name}
                />
              </div>
              {introduction.length === 0 ? null : (
                <section
                  aria-labelledby="imported-introduction"
                  className="mt-8"
                >
                  <h3
                    className="text-sm font-semibold"
                    id="imported-introduction"
                  >
                    О продукте для читателя
                  </h3>
                  <dl className="mt-4 grid gap-6 sm:grid-cols-2">
                    {introduction.map(({ field, label, text }) => (
                      <div className="min-w-0" key={field}>
                        <dt className="text-sm text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="mt-2 whitespace-pre-line text-sm leading-relaxed [overflow-wrap:anywhere]">
                          {text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
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
          learners: (
            <ProductLearnersTab
              productId={collection.id}
              productName={collection.name}
            />
          ),
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
