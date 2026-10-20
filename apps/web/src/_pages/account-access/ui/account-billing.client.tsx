"use client";

import { ReceiptText } from "lucide-react";
import { AccountDisclosure } from "./account-disclosure.client";

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
    <div className="space-y-4">
      {failure}
      {hasSubscription ? <AccountSubscription /> : null}
      {hasPurchases ? (
        <AccountDisclosure
          description="История покупок, платежей и чеков"
          icon={ReceiptText}
          id="purchases"
          title="Покупки и оплаты"
        >
          <PurchasesPanel />
        </AccountDisclosure>
      ) : null}
    </div>
  );
}

function AccountSubscription() {
  const options = useSubscriptionOptions();
  const contact = useBillingContact();
  return (
    <section
      aria-labelledby="account-subscription"
      className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6"
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
