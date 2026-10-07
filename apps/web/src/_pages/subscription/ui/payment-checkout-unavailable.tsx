import type { Route } from "next";

import { BillingSignIn } from "@/features/billing-subscription";

/** A missing Offer requires identity before its product can be resolved. */
export function PaymentCheckoutUnavailable({
  viewer,
  returnTo,
}: {
  readonly viewer: "guest" | "member";
  readonly returnTo: Route;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      {viewer === "guest" ? (
        <BillingSignIn
          description="Войдите, чтобы проверить доступ к выбранному тарифу и продолжить оформление."
          returnTo={returnTo}
        />
      ) : (
        <p role="status">Выбранный тариф сейчас недоступен для покупки.</p>
      )}
    </div>
  );
}
