import type { LinkEffects } from "../modules/identity-linking/link-effects.js";
import { planInitialMembershipCheck } from "../modules/membership-evidence/plan-initial-check.js";
import { signInAllowsLink } from "../modules/bot-sign-in/link-approval.js";
import { findBotContact } from "../modules/bot-contacts/contact-access.js";
import {
  ensureCommunicationContact,
  findCommunicationContact,
} from "../modules/communications/communication-contacts.js";
import { recordAccountLinked } from "../modules/sales-funnel/sales-funnel-events.js";

export const linkEffects: LinkEffects = {
  initialCheck: planInitialMembershipCheck,
  signInAllowsLink,
  accountLinked: async (tx, link) => {
    if (await findBotContact(tx, link.botIdentity, link.telegramUserId))
      await ensureCommunicationContact(
        tx,
        link.botIdentity,
        link.telegramUserId,
      );
    const contact = await findCommunicationContact(
      tx,
      link.botIdentity,
      link.telegramUserId,
    );
    if (contact) await recordAccountLinked(tx, link, contact.contact_id);
  },
};
