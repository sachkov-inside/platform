"use client";

import { ReceiptText } from "lucide-react";
import { AccountProductCommunity } from "./account-product-community.client";
import { AccountDisclosure } from "./account-disclosure.client";

import {
  BillingSignIn,
  BillingHistory,
  useCurrentBilling,
  useOwnEnrollments,
} from "@/features/billing-subscription";
import { ProductAccessList } from "@/features/billing-subscription";

/** Existing billing capabilities stay on the same page, without empty sales sections. */
export function AccountBilling() {
  const billing = useCurrentBilling();
  const enrollments = useOwnEnrollments();
  const value = billing.data?.ok === true ? billing.data.value : null;
  const hasPurchases =
    (value?.payments.length ?? 0) > 0 || (value?.notices.length ?? 0) > 0;

  if (billing.data?.ok === false && billing.data.code === "unauthorized")
    return (
      <BillingSignIn
        description="Войдите, чтобы управлять покупками."
        returnTo="/account"
      />
    );

  if (billing.isPending)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Загружаем покупки…
      </p>
    );

  // Failure must not look like an account with no purchases or tariff assignments.
  const readFailed =
    billing.isError || enrollments.isError || billing.data?.ok !== true;
  const failure = readFailed ? (
    <div className="py-4 text-sm" role="alert">
      <p>Не удалось загрузить покупки.</p>
      <button
        className="mt-2 min-h-11 underline underline-offset-4"
        onClick={() => {
          void billing.refetch();
          void enrollments.refetch();
        }}
        type="button"
      >
        Попробовать снова
      </button>
    </div>
  ) : null;
  if (value === null) return failure;

  return (
    <div className="space-y-4">
      {failure}
      <ProductAccessList
        enrollments={enrollments.data ?? []}
        grounds={value.grounds}
        payments={value.payments}
        renderCommunityAction={(productId) => (
          <AccountProductCommunity productId={productId} />
        )}
      />
      {hasPurchases ? (
        <AccountDisclosure
          description="История покупок, платежей и чеков"
          icon={ReceiptText}
          id="purchases"
          title="Покупки и оплаты"
        >
          <BillingHistory
            embedded
            notices={value.notices}
            payments={value.payments}
          />
        </AccountDisclosure>
      ) : null}
    </div>
  );
}
