"use client";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import type { PriceSnapshot } from "@/entities/subscription";
import { currentBillingQueryOptions } from "@/features/billing-subscription";

import { visibleAccountSections } from "../model/account-sections";
import { AccountSectionNav } from "./account-section-nav.client";

export interface AccountCabinetProps {
  readonly children: ReactNode;
  /** Публичные варианты подписки; каталог читается один раз на весь кабинет. */
  readonly options: readonly PriceSnapshot[];
}

const SubscriptionOptionsContext = createContext<readonly PriceSnapshot[]>([]);

/** Варианты подписки для раздела «Подписка»: тот же каталог, что решил видимость раздела. */
export function useSubscriptionOptions(): readonly PriceSnapshot[] {
  return useContext(SubscriptionOptionsContext);
}

/** Продаётся ли подписка при таком каталоге. Одно правило на весь кабинет. */
function subscriptionOfferedIn(options: readonly PriceSnapshot[]): boolean {
  return options.length > 0;
}

/**
 * Продаётся ли подписка прямо сейчас. Разделы кабинета решают по нему, звать ли на витрину;
 * рамка применяет то же правило к своему каталогу напрямую, потому что провайдер ниже неё.
 */
export function useSubscriptionOffered(): boolean {
  return subscriptionOfferedIn(useSubscriptionOptions());
}

/**
 * Рамка личного кабинета: слева разделы, справа один раздел. Состояние подписки читается тем
 * же ключом, что и сами разделы, поэтому навигация не спорит с их содержимым.
 */
export function AccountCabinet({ children, options }: AccountCabinetProps) {
  const pathname = usePathname();
  // Провайдер стоит ниже, поэтому рамка считает то же правило по своему же каталогу.
  const subscriptionOffered = subscriptionOfferedIn(options);
  const billing = useQuery({
    ...currentBillingQueryOptions(),
    enabled: !subscriptionOffered,
  });
  const subscription =
    billing.data?.ok === true ? billing.data.value.subscription : null;
  const sections = visibleAccountSections({
    subscriptionOffered,
    // Завершённая подписка ничего не даёт: разделу нечего показать и нечем управлять.
    subscriptionOwned: subscription !== null && subscription.state !== "ended",
  });

  return (
    <div className="mx-auto w-full max-w-6xl lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <AccountSectionNav currentHref={pathname} sections={sections} />
      <div className="min-w-0">
        <SubscriptionOptionsContext value={options}>
          {children}
        </SubscriptionOptionsContext>
      </div>
    </div>
  );
}
