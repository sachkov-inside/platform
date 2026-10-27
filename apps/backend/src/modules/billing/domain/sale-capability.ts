export interface PaymentAmountLimits {
  readonly minimumKopecks: number;
  readonly maximumKopecks: number;
}
/** Direct Product payments require a configured terminal and receipt contact. */
export interface SaleCapability {
  readonly payments: boolean;
  readonly amountLimits?: PaymentAmountLimits | undefined;
}
export function saleCapability(
  terminal: Partial<PaymentAmountLimits> | undefined,
  receiptContactConfigured: boolean,
): SaleCapability {
  return {
    payments: terminal !== undefined && receiptContactConfigured,
    ...(terminal?.minimumKopecks === undefined ||
    terminal.maximumKopecks === undefined
      ? {}
      : {
          amountLimits: {
            minimumKopecks: terminal.minimumKopecks,
            maximumKopecks: terminal.maximumKopecks,
          },
        }),
  };
}
