import type { PrivateMemberProfileState } from "@/entities/member-profile";

import type { AccountTelegramMembership } from "./account-telegram-membership";

export type AccountPresentation = Readonly<{
  profile: PrivateMemberProfileState;
  telegramMembership: AccountTelegramMembership;
}>;

export type AccountPresentationResult =
  | Readonly<{ kind: "ready"; presentation: AccountPresentation }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{ kind: "unavailable"; reference: string }>;
