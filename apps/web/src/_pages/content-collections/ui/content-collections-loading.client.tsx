"use client";

import { Archive, Plus } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { WorkspaceTabs } from "@/shared/ui/workspace-tabs.client";
import {
  AdminFilterBarSkeleton,
  AdminListHeader,
  AdminTableSkeleton,
} from "@/shared/ui/admin";

import type { ContentCollectionKind } from "../model/content-collections";
import { ProductPageNavigation } from "./product-page-navigation.client";
import { productPageTabLabels } from "./product-page-tabs.client";
import { SeriesEditorPageFrame } from "./series-editor-page-frame";

/**
 * Загрузка списка тем или продуктов в раскладке готовой страницы: тот же заголовок, скелеты строки
 * поиска и таблицы на местах настоящих, поэтому пришедший список ничего не сдвигает.
 */
export function ContentCollectionsLoading({
  kind,
}: {
  readonly kind: ContentCollectionKind;
}) {
  return (
    <main className="authoring-page" id="authoring-content" tabIndex={-1}>
      <div className="authoring-page-body">
        <AdminListHeader
          action={
            // Невидимая копия кнопки создания держит высоту заголовка готовой страницы.
            <span aria-hidden="true" className="invisible" inert>
              <Button type="button">
                <Plus aria-hidden="true" />
                {kind === "topic" ? "Создать тему" : "Создать продукт"}
              </Button>
            </span>
          }
          count="Загружаем…"
          title={kind === "topic" ? "Темы" : "Продукты"}
        />
        <section aria-busy="true" className="grid gap-4">
          <AdminFilterBarSkeleton filters={1} />
          {kind === "series" ? (
            <div aria-hidden="true" className="min-h-28 sm:min-h-16" />
          ) : null}
          <AdminTableSkeleton
            columns={kind === "topic" ? 4 : 5}
            label={kind === "topic" ? "Загружаем темы" : "Загружаем продукты"}
          />
        </section>
      </div>
    </main>
  );
}

const panelSkeleton = (
  <div className="grid gap-3 py-6">
    {["70%", "55%", "62%", "48%"].map((width) => (
      <span className="admin-skeleton-bar h-4" key={width} style={{ width }} />
    ))}
  </div>
);

/** Загрузка страницы продукта: строка возврата, заголовок и вкладки на своих местах. */
export function ProductPageLoading() {
  return (
    <SeriesEditorPageFrame>
      <ProductPageNavigation>
        {/* Невидимая копия состояния и архива держит высоту строки готовой страницы. */}
        <div
          aria-hidden="true"
          className="invisible flex items-center gap-3"
          inert
        >
          <span className="max-w-36 text-xs">Настройки сохранены</span>
          <Button type="button" variant="ghost">
            <Archive aria-hidden="true" />В архив
          </Button>
        </div>
      </ProductPageNavigation>
      <header className="authoring-page-heading" role="status">
        <span className="sr-only">Загружаем продукт</span>
        <span
          aria-hidden="true"
          className="flex h-[30px] items-center md:h-[35px]"
        >
          <span className="admin-skeleton-bar h-6 w-2/3 max-w-md" />
        </span>
        <p>Программа, описание и настройки продукта.</p>
      </header>
      <div aria-hidden="true" inert>
        <WorkspaceTabs
          label="Разделы продукта"
          tabs={[
            {
              id: "program",
              label: productPageTabLabels.program,
              panel: panelSkeleton,
            },
            {
              id: "description",
              label: productPageTabLabels.description,
              panel: panelSkeleton,
            },
            {
              id: "artifacts",
              label: productPageTabLabels.artifacts,
              panel: panelSkeleton,
            },
            {
              id: "settings",
              label: productPageTabLabels.settings,
              panel: panelSkeleton,
            },
          ]}
        />
      </div>
    </SeriesEditorPageFrame>
  );
}
