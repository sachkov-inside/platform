import type { Metadata } from "next";

import { SubscriptionPage } from "@/_pages/subscription.server";
import { subscriptionRouteTarget } from "@/shared/routing/subscription-route";

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
  const query = await searchParams;
  return <SubscriptionPage target={subscriptionRouteTarget(query.from)} />;
}
