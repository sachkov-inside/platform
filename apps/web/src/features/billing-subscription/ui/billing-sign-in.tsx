import type { Route } from "next";

import { LegalDocumentLinks } from "@/entities/legal-document";
import { billingActionClass } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

/** Закрытый раздел не показывает чужие данные и не притворяется пустым: он просит войти. */
export function BillingSignIn({
  description,
  returnTo,
}: {
  readonly description: string;
  readonly returnTo: Route;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <p className="text-sm leading-6">{description}</p>
      <form action="/auth/sign-in" className="mt-4" method="post">
        <input name="returnTo" type="hidden" value={returnTo} />
        <Button className={billingActionClass} type="submit">
          Войти
        </Button>
      </form>
      <LegalDocumentLinks
        className="mt-5 border-t border-border pt-4"
        label="Перед входом:"
        keys={["terms", "privacy"]}
      />
    </div>
  );
}
