"use client";

import type { ReactNode } from "react";

import { WorkspaceTabs } from "@/shared/ui/workspace-tabs.client";

import {
  parseProductPageTab,
  productPageTabIds,
  type ProductPageTabId,
} from "../model/product-page-tabs";
import { useProductPageTab } from "../model/use-product-page-tab.client";

export const productPageTabLabels: Record<ProductPageTabId, string> = {
  program: "Программа",
  description: "Описание и витрина",
  sale: "Продажа",
  learners: "Ученики",
  community: "Сообщество и активация",
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
        tabOf(productPageTabIds[0], panels),
        ...productPageTabIds.slice(1).map((id) => tabOf(id, panels)),
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
