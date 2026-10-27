import type { Metadata } from "next";

import { ProductEditorPage } from "@/_pages/content-collections.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Редактирование продукта" };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly productId: string }>;
}) {
  const { productId } = await params;
  return <ProductEditorPage productId={productId} />;
}
