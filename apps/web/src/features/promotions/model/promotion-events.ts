import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Скидки владельца изменились: каждая открытая поверхность перечитывает свой список скидок. */
export const promotionsChanged = factAnnouncement(
  "inside.owner.promotions.changed",
);
