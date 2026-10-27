import { telegramContactSchema } from "@inside/contracts/telegram-contact";
import type { TelegramUserProfile } from "../../shared/telegram-contact.js";

/**
 * The name and username of a Telegram user object, by the rules of the contact projection.
 * `undefined` means the user object does not fit them and is not a profile.
 */
export function telegramUserProfile(user: {
  readonly first_name?: unknown;
  readonly last_name?: unknown;
  readonly username?: unknown;
}): TelegramUserProfile | undefined {
  const name = [user.first_name, user.last_name]
    .filter((part) => typeof part === "string" && part !== "")
    .join(" ")
    .trim();
  const displayName = telegramContactSchema.shape.displayName.safeParse(
    name === "" ? null : name.slice(0, 160),
  );
  const username = telegramContactSchema.shape.username.safeParse(
    user.username ?? null,
  );
  return displayName.success && username.success
    ? { displayName: displayName.data, username: username.data }
    : undefined;
}
