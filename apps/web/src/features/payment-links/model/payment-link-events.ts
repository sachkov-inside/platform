import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Ссылки на оплату изменились: каждая открытая поверхность перечитывает свой список. */
export const paymentLinksChanged = factAnnouncement(
  "inside.payment-links.changed",
);
