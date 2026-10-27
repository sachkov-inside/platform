import type { TelegramChatMember } from "../membership-evidence/membership-normalization.js";

interface DurableMembershipEnvelopeBase {
  readonly botIdentity: string;
  readonly canonicalChatId: string;
  readonly chatMember: TelegramChatMember;
  readonly eventAt: Date;
  readonly updateId: string;
}

export type DurableMembershipEnvelope =
  | (DurableMembershipEnvelopeBase & {
      readonly actorIsSubject: boolean;
      readonly actorTelegramUserId?: string;
      readonly actorIsBot?: boolean;
      readonly kind: "subject";
      readonly subjectTelegramUserId: string;
    })
  | (DurableMembershipEnvelopeBase & { readonly kind: "provider" });
