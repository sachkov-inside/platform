interface ScenarioPaymentProduct {
  readonly key: string;
  readonly name: string;
  readonly shortName: string;
}
export const paymentScenario: {
  readonly products: readonly ScenarioPaymentProduct[];
  readonly storybook: { readonly priceRevision: number };
  readonly navigation: {
    readonly priceRevision: number;
    readonly count: number;
  };
  readonly orderEmail: string;
  readonly currency: "RUB";
  readonly timezone: "Europe/Moscow";
  readonly offer: {
    readonly revision: number;
    readonly benefits: readonly ["materials"];
    readonly archived: false;
    readonly published: true;
  };
  readonly option: {
    readonly revision: number;
    readonly mode: "one_time";
    readonly months: number;
    readonly archived: false;
  };
};
export const navigationPaymentProducts: readonly ScenarioPaymentProduct[];
export function paymentFacts(
  index: number,
  variant: "storybook" | "navigation",
): {
  readonly product: ScenarioPaymentProduct;
  readonly amountKopecks: number;
  readonly state:
    "authorized" | "confirmed" | "failed" | "pending" | "sent" | "unknown";
  readonly occurredAt: string;
  readonly access:
    "awaiting_payment" | "preparing" | "ready" | "review_required";
  readonly environment: "demo" | "production";
  readonly terminalRef: string;
  readonly priceRevision: number;
  readonly bankPaymentId: string;
  readonly refundedKopecks: number | null;
  readonly refundableKopecks: number | null;
};
