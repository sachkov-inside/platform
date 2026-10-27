import type { Metadata } from "next";

import { ProductEditorPage } from "@/_pages/content-collections.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Редактирование продукта" };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly productId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ productId }, { tab }] = await Promise.all([params, searchParams]);
  return (
    <ProductEditorPage
      productId={productId}
      tab={typeof tab === "string" ? tab : null}
    />
  );
}
