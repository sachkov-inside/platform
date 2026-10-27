import type {
  TelegramContact,
  TelegramContactQuery,
} from "@inside/contracts/telegram-contact";
import type {
  TelegramContactMatch,
  TelegramContactV2,
} from "@inside/contracts/telegram-contact-v2";

/** `not_supported` is a Telegram release without the v2 contract (404); retrying cannot help. */
type TelegramContactsV2Failure = {
  readonly ok: false;
  readonly reason: "not_supported" | "unavailable";
};

export interface TelegramContactsProvider {
  read(
    contacts: readonly TelegramContactQuery[],
  ): Promise<
    | { readonly ok: true; readonly contacts: readonly TelegramContact[] }
    | { readonly ok: false }
  >;
  /** `inside.telegram-contact.v2` read: the v1 projection plus the `/stop` state. */
  readWithMarketing(
    contacts: readonly TelegramContactQuery[],
  ): Promise<
    | { readonly ok: true; readonly contacts: readonly TelegramContactV2[] }
    | TelegramContactsV2Failure
  >;
  /** Name or username search over the stored profiles of the bot's current links. */
  search(
    query: string,
    limit: number,
  ): Promise<
    | {
        readonly ok: true;
        readonly matches: readonly TelegramContactMatch[];
        readonly truncated: boolean;
      }
    | TelegramContactsV2Failure
  >;
}
