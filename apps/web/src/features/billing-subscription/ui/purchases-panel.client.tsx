"use client";
import type { Route } from "next";
import { useMutation } from "@tanstack/react-query";

import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  changeBillingPaymentMethod,
  revokeBillingPaymentMethod,
} from "../api/billing-subscription.browser";
import { assignLocation } from "../model/navigate";
import { useBillingCabinet } from "../model/use-billing-cabinet.client";
import { PurchasesSectionView } from "./purchases-view.client";

export interface PurchasesPanelProps {
  readonly storefrontHref: Route;
  readonly onNavigate?: (url: string) => void;
}

/** Производственный путь раздела «Покупки»: одно чтение billing и команды способа оплаты. */
export function PurchasesPanel({
  storefrontHref,
  onNavigate,
}: PurchasesPanelProps) {
  const cabinet = useBillingCabinet();
  const { operationId } = useRepeatableOperations();
  const { subscription } = cabinet;

  const changeMethod = useMutation({
    mutationFn: changeBillingPaymentMethod,
    retry: false,
    onSuccess: (result) => {
      cabinet.settle(result, (value) => {
        cabinet.refresh();
        if (value.formUrl !== null) (onNavigate ?? assignLocation)(value.formUrl);
      });
    },
  });
  const revokeMethod = useMutation({
    mutationFn: revokeBillingPaymentMethod,
    retry: false,
    onSuccess: (result) => {
      cabinet.settle(result, cabinet.applySubscription);
    },
  });

  return (
    <PurchasesSectionView
      error={cabinet.error}
      grounds={cabinet.billing?.grounds ?? []}
      loading={cabinet.loading}
      notices={cabinet.billing?.notices ?? []}
      onChangeMethod={() => {
        if (subscription === null) return;
        cabinet.setError(undefined);
        changeMethod.mutate({
          operationId: operationId("method-change", {
            revision: subscription.revision,
          }),
          expectedRevision: subscription.revision,
        });
      }}
      onRefresh={cabinet.refresh}
      onRevokeMethod={() => {
        if (subscription?.paymentMethod == null) return;
        cabinet.setError(undefined);
        revokeMethod.mutate({
          operationId: operationId("method-revoke", {
            revision: subscription.revision,
          }),
          expectedRevision: subscription.revision,
          paymentMethodRef: subscription.paymentMethod.methodRef,
        });
      }}
      payments={cabinet.billing?.payments ?? []}
      pending={changeMethod.isPending || revokeMethod.isPending}
      sessionExpired={cabinet.sessionExpired}
      storefrontHref={storefrontHref}
      subscription={subscription}
    />
  );
}
