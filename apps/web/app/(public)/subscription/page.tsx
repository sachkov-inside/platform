import type { Metadata } from "next";
import { connection } from "next/server";

import { SubscriptionPage } from "@/_pages/subscription.server";
import { subscriptionRouteTarget } from "@/shared/routing/subscription-route";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0026). */
export const instant = false;

export const metadata: Metadata = {
  title: "Подписка",
  description:
    "Тарифы Sachkov Inside: состав доступа, точная цена и оформление подписки.",
};

export default async function SubscriptionRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] }>;
}) {
  // Витрина читает цены без токена, поэтому до первого чтения сессии её работа попала бы в
  // предзагрузку. `connection()` оставляет её запросу, как у остальных разделов, зависящих от сессии.
  await connection();
  const query = await searchParams;
  return <SubscriptionPage target={subscriptionRouteTarget(query.from)} />;
}
