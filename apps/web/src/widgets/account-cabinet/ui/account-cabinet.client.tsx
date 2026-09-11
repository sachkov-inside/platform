"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { currentBillingQueryOptions } from "@/features/billing-subscription";

import { visibleAccountSections } from "../model/account-sections";
import { AccountSectionNav } from "./account-section-nav.client";

export interface AccountCabinetProps {
  readonly children: ReactNode;
  /** Продаётся ли подписка сейчас; приходит с сервера вместе с каталогом вариантов. */
  readonly subscriptionOffered: boolean;
}

/**
 * Рамка личного кабинета: слева разделы, справа один раздел. Состояние подписки читается тем
 * же ключом, что и сами разделы, поэтому навигация не спорит с их содержимым.
 */
export function AccountCabinet({
  children,
  subscriptionOffered,
}: AccountCabinetProps) {
  const pathname = usePathname();
  const billing = useQuery({
    ...currentBillingQueryOptions(),
    enabled: !subscriptionOffered,
  });
  const subscriptionOwned =
    billing.data?.ok === true && billing.data.value.subscription !== null;
  const sections = visibleAccountSections({
    subscriptionOffered,
    subscriptionOwned,
  });

  return (
    <div className="mx-auto w-full max-w-6xl lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <AccountSectionNav currentHref={pathname} sections={sections} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
