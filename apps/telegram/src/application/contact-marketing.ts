import type { ContactMarketing } from "../modules/identity-linking/contact-marketing.js";
import { marketingPreferences } from "../modules/communications/communication-contacts.js";

export const contactMarketing: ContactMarketing = {
  read: marketingPreferences,
};
