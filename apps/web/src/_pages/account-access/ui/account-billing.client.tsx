"use client";

import { useEffect, useRef } from "react";

import { LegalDocumentLinks } from "@/entities/legal-document";
import { useBillingContact } from "@/features/billing-contact";
import {
  BillingSignIn,
  PurchasesPanel,
  SubscriptionPanel,
  useCurrentBilling,
  useOwnEnrollments,
} from "@/features/billing-subscription";
import { useSubscriptionOptions } from "@/widgets/account-cabinet";

/** Existing billing capabilities stay on the same page, without empty sales sections. */
export function AccountBilling() {
  const billing = useCurrentBilling();
  const enrollments = useOwnEnrollments();
  const value = billing.data?.ok === true ? billing.data.value : null;
  const hasSubscription =
    (value?.subscription != null && value.subscription.state !== "ended") ||
    (enrollments.data?.length ?? 0) > 0;
  const hasPurchases =
    value?.subscription != null ||
    hasSubscription ||
    (value?.grounds.length ?? 0) > 0 ||
    (value?.payments.length ?? 0) > 0 ||
    (value?.notices.length ?? 0) > 0;

  const purchases = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const revealPurchases = () => {
      if (window.location.hash === "#purchases" && purchases.current !== null)
        purchases.current.open = true;
    };
    revealPurchases();
    window.addEventListener("hashchange", revealPurchases);
    return () => {
      window.removeEventListener("hashchange", revealPurchases);
    };
  }, [hasPurchases, billing.isPending]);

  if (billing.data?.ok === false && billing.data.code === "unauthorized")
    return (
      <BillingSignIn
        description="Войдите, чтобы управлять покупками и подпиской."
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
      <p>Не удалось загрузить покупки и подписку.</p>
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
    <>
      {failure}
      {hasSubscription ? <AccountSubscription /> : null}
      {hasPurchases ? (
        <details
          ref={purchases}
          className="border-b border-border py-5"
          id="purchases"
        >
          <summary className="min-h-11 cursor-pointer content-center text-lg font-semibold">
            Покупки и оплаты
          </summary>
          <div className="pt-4">
            <PurchasesPanel />
          </div>
        </details>
      ) : null}
    </>
  );
}

function AccountSubscription() {
  const options = useSubscriptionOptions();
  const contact = useBillingContact();
  return (
    <section
      aria-labelledby="account-subscription"
      className="border-b border-border py-6"
      id="subscription"
    >
      <h2 className="mb-4 text-lg font-semibold" id="account-subscription">
        Подписка
      </h2>
      <SubscriptionPanel
        options={options}
        resumeDocuments={
          contact.data?.ok === true ? contact.data.documents : []
        }
      />
      <LegalDocumentLinks
        className="mt-4"
        label="Условия подписки и порядок обращений:"
        keys={["subscription", "recurring-consent", "contacts"]}
      />
    </section>
  );
}
