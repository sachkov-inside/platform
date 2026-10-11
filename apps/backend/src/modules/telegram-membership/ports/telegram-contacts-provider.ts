import type {
  TelegramContact,
  TelegramContactQuery,
} from "@inside/contracts/telegram-contact";

export interface TelegramContactsProvider {
  read(
    contacts: readonly TelegramContactQuery[],
  ): Promise<
    | { readonly ok: true; readonly contacts: readonly TelegramContact[] }
    | { readonly ok: false }
  >;
}
