export interface RegisterTelegramLinkRequest {
  readonly accountRef: string;
  readonly expiresAt: Date;
  readonly returnCorrelation: string;
  readonly tokenDigest: string;
}

export type TelegramLinkProviderRegistration =
  | Readonly<{
      kind: "registered";
      expiresAt: Date;
      linkTransactionRef: string;
      returnCorrelation: string;
    }>
  | Readonly<{
      kind:
        | "conflict"
        | "expired"
        | "recovery_required"
        | "replayed"
        | "unavailable";
    }>;

export interface ConfirmTelegramLinkRequest {
  readonly accountRef: string;
  readonly linkTransactionRef: string;
  readonly returnCorrelation: string;
}

export type TelegramLinkProviderConfirmation =
  | Readonly<{
      kind: "linked";
      linkTransactionRef: string;
      returnCorrelation: string;
      telegramIdentityRef: string;
    }>
  | Readonly<{
      kind:
        | "conflict"
        | "expired"
        | "pending"
        | "recovery_required"
        | "replayed"
        | "unavailable";
    }>;

export interface TelegramLinkProvider {
  register(
    request: RegisterTelegramLinkRequest,
  ): Promise<TelegramLinkProviderRegistration>;
  confirm(
    request: ConfirmTelegramLinkRequest,
  ): Promise<TelegramLinkProviderConfirmation>;
}
