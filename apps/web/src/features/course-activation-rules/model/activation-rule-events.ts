import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Правила активации прежних курсов изменились: открытые поверхности перечитывают их список. */
export const activationRulesChanged = factAnnouncement(
  "inside.owner.activation-rules.changed",
);
