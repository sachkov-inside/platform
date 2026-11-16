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
