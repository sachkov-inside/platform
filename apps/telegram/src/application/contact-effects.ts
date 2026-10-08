import type { ContactEffects } from "../modules/bot-contacts/contact-effects.js";
import { contactLock } from "../modules/communications/communication-state.js";
import { updateMarketingAvailability } from "../modules/communications/marketing-preferences.js";
import { ensureCommunicationContact } from "../modules/communications/communication-contacts.js";
import { enqueueReply } from "../modules/outbound/start-response-delivery-queue.js";

export const contactEffects: ContactEffects = {
  lock: contactLock,
  availability: updateMarketingAvailability,
  ensure: ensureCommunicationContact,
  reply: (tx, start, text) =>
    enqueueReply(tx, {
      botIdentity: start.botIdentity,
      telegramUserId: start.telegramUserId,
      privateChatId: start.privateChatId,
      messageText: text,
      sourceKey: `telegram-update:${start.botIdentity}:${start.updateId}`,
      triggerUpdateId: start.updateId,
      now: start.observedAt,
    }),
};
