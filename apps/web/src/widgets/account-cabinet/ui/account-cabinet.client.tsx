"use client";
import { createContext, useContext, type ReactNode } from "react";

import type { PriceSnapshot } from "@/entities/subscription";
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

/** Single account page; the provider keeps existing subscription commands on their shared catalog. */
export function AccountCabinet({ children, options }: AccountCabinetProps) {
  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <SubscriptionOptionsContext value={options}>
        {children}
      </SubscriptionOptionsContext>
    </div>
  );
}
