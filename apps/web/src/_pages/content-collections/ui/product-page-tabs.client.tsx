"use client";

import type { ReactNode } from "react";

import { WorkspaceTabs } from "@/shared/ui/workspace-tabs.client";

import {
  parseProductPageTab,
  type ProductPageTabId,
} from "../model/product-page-tabs";
import { useProductPageTab } from "../model/use-product-page-tab.client";

export const productPageTabLabels: Record<ProductPageTabId, string> = {
  program: "Программа",
  description: "Описание и обложка",
  artifacts: "Материалы продукта",
  settings: "Настройки",
};

/**
 * Вкладки страницы продукта, выбранные адресом `?tab=`. Скрытые вкладки остаются смонтированными,
 * поэтому черновик описания переживает и смену вкладки, и «назад» с «вперёд».
 */
export function ProductPageTabs({
  panels,
}: {
  readonly panels: Readonly<Record<ProductPageTabId, ReactNode>>;
}) {
  const [tab, select] = useProductPageTab();
  return (
    <WorkspaceTabs
      label="Разделы продукта"
      onSelect={(id) => {
        select(parseProductPageTab(id));
      }}
      selectedId={tab}
      tabs={[
        tabOf("program", panels),
        tabOf("description", panels),
        tabOf("artifacts", panels),
        tabOf("settings", panels),
      ]}
    />
  );
}

function tabOf(
  id: ProductPageTabId,
  panels: Readonly<Record<ProductPageTabId, ReactNode>>,
) {
  return { id, label: productPageTabLabels[id], panel: panels[id] };
}
