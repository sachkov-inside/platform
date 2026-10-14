import type { AccessGround, OwnPayment } from "@/entities/subscription";
import { productOnlyOffer, ownPayments } from "./billing.fixtures";
import { seriesJourneyCorpus } from "./series-journey-corpus.fixtures";
export const buyerProductId =
  productOnlyOffer.offer.benefits[0]?.slice("product:".length) ?? "";
export const buyerProductName = "Создание Platform Inside";
export function buyerProgrammeFixture(name: string) {
  const corpus = seriesJourneyCorpus();
  const titles = [
    "Начало работы",
    "Подготовка проекта",
    "Первое приложение",
    "Данные",
    "Проверки",
    "Выпуск",
  ];
  const items = corpus.items.slice(0, 6).map((item, index) => ({
    ...item,
    title: titles[index] ?? item.title,
    availability: "available" as const,
  }));
  return {
    ...corpus,
    reference: {
      ...corpus.reference,
      id: buyerProductId,
      name,
      slug: "platform-inside",
    },
    items,
    chapters: [
      {
        id: "demo-start",
        name: "Начало работы",
        summary: "",
        materialIds: items
          .slice(0, 3)
          .flatMap((item) =>
            item.materialId === undefined ? [] : [item.materialId],
          ),
      },
      {
        id: "demo-application",
        name: "Приложение",
        summary: "",
        materialIds: items
          .slice(3)
          .flatMap((item) =>
            item.materialId === undefined ? [] : [item.materialId],
          ),
      },
    ],
  };
}

export const buyerProductContent = {
  id: buyerProductId,
  kind: "product" as const,
  title: buyerProductName,
  slug: "platform-inside",
  available: true,
};
export const buyerGrounds: readonly AccessGround[] = [
  {
    source: "paid",
    content: [buyerProductContent],
    capabilities: [`product:${buyerProductId}`],
    startsAt: "2026-10-01T10:00:00.000Z",
    validUntil: null,
    active: true,
  },
  {
    source: "paid",
    content: [buyerProductContent],
    capabilities: ["support"],
    startsAt: "2026-10-01T10:00:00.000Z",
    validUntil: "2027-04-01T10:00:00.000Z",
    active: true,
  },
];
export const buyerPayments: readonly OwnPayment[] = ownPayments
  .slice(0, 1)
  .map((payment) => ({
    ...payment,
    content: [buyerProductContent],
    snapshot: productOnlyOffer,
    access: "ready",
  }));
