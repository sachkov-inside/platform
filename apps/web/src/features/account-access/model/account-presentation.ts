import type { PrivateAccountProfileState } from "@/entities/account-profile";

import type { AccountTelegramMembership } from "./account-telegram-membership";

export type AccountPresentation = Readonly<{
  profile: PrivateAccountProfileState;
  telegramMembership: AccountTelegramMembership;
}>;

export type AccountPresentationResult =
  | Readonly<{ kind: "ready"; presentation: AccountPresentation }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{ kind: "unavailable"; reference: string }>;
