export const TELEGRAM_CONTACT_PROFILE = Symbol("TELEGRAM_CONTACT_PROFILE");
export type ContactProfileResult =
  | {
      readonly kind: "available";
      readonly displayName: string | null;
      readonly username: string | null;
    }
  | { readonly kind: "unavailable" };
export interface TelegramContactProfile {
  read(
    telegramUserId: string,
    signal: AbortSignal,
  ): Promise<ContactProfileResult>;
}
export class DisabledTelegramContactProfile implements TelegramContactProfile {
  read(): Promise<ContactProfileResult> {
    return Promise.resolve({ kind: "unavailable" });
  }
}
