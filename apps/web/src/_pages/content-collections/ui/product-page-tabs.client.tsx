"use client";

import { useState, type ReactNode } from "react";

import { WorkspaceTabs } from "@/shared/ui/workspace-tabs.client";

import {
  parseProductPageTab,
  productPageTabIds,
  type ProductPageTabId,
} from "../model/product-page-tabs";
import { useProductPageTab } from "../model/use-product-page-tab.client";

export const productPageTabLabels: Record<ProductPageTabId, string> = {
  overview: "Обзор",
  program: "Программа",
  description: "Описание и витрина",
  sale: "Продажа",
  learners: "Ученики",
  community: "Сообщество и активация",
};

/**
 * Вкладки, которые монтируются только с первым открытием: их панели читают обзор, продажи и
 * сообщество продукта, а открытие страницы продукта на другой вкладке этих чтений не просит.
 */
const deferredTabs: ReadonlySet<ProductPageTabId> = new Set([
  "overview",
  "sale",
  "community",
]);

/**
 * Вкладки страницы продукта, выбранные адресом `?tab=`. Скрытые вкладки остаются смонтированными,
 * поэтому черновик описания переживает и смену вкладки, и «назад» с «вперёд». «Обзор», «Продажа» и
 * «Сообщество и активация» монтируются при первом открытии и дальше тоже остаются.
 */
export function ProductPageTabs({
  panels,
}: {
  readonly panels: Readonly<Record<ProductPageTabId, ReactNode>>;
}) {
  const [tab, select] = useProductPageTab();
  const [opened, setOpened] = useState<ReadonlySet<ProductPageTabId>>(
    () => new Set([tab]),
  );
  // Открытая вкладка запоминается во время отрисовки: панель появляется в том же кадре.
  if (!opened.has(tab)) setOpened(new Set([...opened, tab]));
  const shown = (id: ProductPageTabId) =>
    deferredTabs.has(id) && !opened.has(id) ? null : panels[id];
  return (
    <WorkspaceTabs
      label="Разделы продукта"
      onSelect={(id) => {
        select(parseProductPageTab(id));
      }}
      selectedId={tab}
      tabs={[
        tabOf(productPageTabIds[0], shown),
        ...productPageTabIds.slice(1).map((id) => tabOf(id, shown)),
      ]}
    />
  );
}

function tabOf(
  id: ProductPageTabId,
  panel: (id: ProductPageTabId) => ReactNode,
) {
  return { id, label: productPageTabLabels[id], panel: panel(id) };
}
