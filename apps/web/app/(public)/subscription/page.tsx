import type { Metadata } from "next";
import { connection } from "next/server";

import { SubscriptionPage } from "@/_pages/subscription.server";
import { subscriptionRouteTarget } from "@/shared/routing/subscription-route";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Подписка",
  description:
    "Тарифы Sachkov Inside: состав доступа, точная цена и оформление подписки.",
};

export default async function SubscriptionRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly from?: string | readonly string[];
    readonly offer?: string | readonly string[];
  }>;
}) {
  // Витрина читает каталог от имени читателя: какие предложения ему продаются, решает его сессия.
  // `connection()` оставляет эту работу запросу, как у остальных разделов, зависящих от сессии.
  await connection();
  const query = await searchParams;
  return (
    <SubscriptionPage
      target={subscriptionRouteTarget(query.from, query.offer)}
    />
  );
}
