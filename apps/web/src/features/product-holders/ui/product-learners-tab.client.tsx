"use client";

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  announceEnrollmentChange,
  subscribeEnrollmentChange,
} from "@/entities/subscription";
import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";
import { internalRoute } from "@/shared/routing/internal-route";

import type { BulkGrantSend } from "../model/bulk-grant";
import {
  holdersAddressSearch,
  readHoldersAddress,
  type HoldersAddress,
} from "../model/product-holders";
import {
  productHoldersQueryOptions,
  productHoldersQueryKey,
} from "../model/product-holders-query-options";
import {
  BulkGrantProductDialog,
  type UseGrantPeopleSearch,
} from "./bulk-grant-product-dialog.client";
import {
  ProductHoldersTable,
  type ProductHoldersViewState,
} from "./product-holders-table.client";

const enrollmentChanges = { subscribe: subscribeEnrollmentChange };

export interface ProductLearnersTabProps {
  readonly productId: string;
  /** Название в заголовке выдачи: «Выдать «Название»». */
  readonly productName: string;
  /** Поиск людей для выбора; страница передаёт поиск #1721 через небольшой адаптер. */
  readonly usePeopleSearch: UseGrantPeopleSearch;
  /** Одна ручная выдача Product Access, например `issueProductAccessOperation.send`. */
  readonly issueProductAccess: BulkGrantSend;
}

/**
 * Вкладка «Ученики» страницы продукта: таблица обладателей с прогрессом и «Выдать продукт».
 * Страница и фильтр живут в адресе (`?tab=learners&cursor=&access=`). Скрытая вкладка остаётся
 * смонтированной, поэтому список читается, только когда вкладка открыта адресом.
 */
export function ProductLearnersTab({
  productId,
  productName,
  usePeopleSearch,
  issueProductAccess,
}: ProductLearnersTabProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [granting, setGranting] = useState(false);
  const address = readHoldersAddress(searchParams);
  const holders = useQuery({
    ...productHoldersQueryOptions({ productId, ...address }),
    enabled: searchParams.get("tab") === "learners",
    placeholderData: keepPreviousData,
  });

  useAnnouncedRefresh(enrollmentChanges, productHoldersQueryKey(productId));

  const hrefFor = (next: HoldersAddress) =>
    internalRoute(
      `${pathname}${holdersAddressSearch(searchParams.toString(), next)}`,
    );
  const state: ProductHoldersViewState = holders.data ?? { kind: "loading" };

  return (
    <>
      <ProductHoldersTable
        address={address}
        hrefFor={hrefFor}
        onAddressChange={(next) => {
          router.push(hrefFor(next), { scroll: false });
        }}
        onGrant={() => {
          setGranting(true);
        }}
        onRetry={() => {
          void holders.refetch();
        }}
        refreshing={holders.isPlaceholderData}
        state={state}
      />
      <BulkGrantProductDialog
        onGranted={() => {
          const announcementId = announceEnrollmentChange();
          void refreshAnnouncedQueries(
            queryClient,
            productHoldersQueryKey(productId),
            announcementId,
          );
        }}
        onOpenChange={setGranting}
        open={granting}
        productId={productId}
        productName={productName}
        send={issueProductAccess}
        usePeopleSearch={usePeopleSearch}
      />
    </>
  );
}
