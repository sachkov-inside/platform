export const commerceScenario: {
  readonly product: typeof import("./learning.mjs").learningScenario.product;
  readonly buyer: "learner";
  readonly priceKopecks: number;
  readonly paymentState: "pending";
  readonly checkoutButtonLabel: string;
  readonly waitlist: {
    readonly intakeId: string;
    readonly name: string;
    readonly accepting: true;
    readonly source: string;
  };
  readonly telegram: {
    readonly identityRef: string;
    readonly displayName: string;
    readonly username: string;
    readonly marketing: "stopped";
  };
};

export const isolatedTelegramSecret: string;

export const commerceFixtureFacts: {
  readonly operationRef: string;
  readonly buyerAccountId: string;
  readonly purchaseRef: string;
  readonly createdAt: string;
  readonly buyerEmail: string;
  readonly priceRevision: number;
  readonly supportMonths: 3;
  readonly communityPolicy: "explicit";
  readonly currency: "RUB";
  readonly timezone: "Europe/Moscow";
  readonly kind: "one_time";
  readonly environment: "local";
  readonly terminalRef: string;
  readonly paymentId: string;
  readonly fiscalization: "pending";
  readonly access: "awaiting_payment";
  readonly refundedKopecks: number;
  readonly refundableKopecks: number;
};
