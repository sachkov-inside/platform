import type { StoryPerson } from "@/storybook/people.fixtures";

import type { ProductHolder } from "../model/product-holders";

/** Продукт историй «Учеников»: те же поля, что даст страница продукта. */
export const storyProductId = "97000000-0000-4000-8000-000000000001";
export const storyProductName = "AI Engineering: разработка с агентами";
export const storyProductPath = `/authoring/products/${storyProductId}`;

/** Разные начала ID, как у настоящих аккаунтов: короткий ID в строке отличает людей. */
export function storyAccountId(index: number): string {
  const prefix = Math.imul(index + 1, 2_654_435_761) >>> 0;
  return `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

const hour = 3_600_000;

/** Детерминированные ученики, новые сверху: без случайности и текущих часов. */
export function storyHolders(count: number): ProductHolder[] {
  return Array.from({ length: count }, (_, index) => {
    const issued = Date.UTC(2026, 9, 24, 9, 30) - index * 31 * hour;
    const started = index % 4 !== 3;
    const revoked = index % 9 === 5;
    const readCount = started ? (index * 7) % 41 : 0;
    return {
      accountId: storyAccountId(index),
      access: revoked ? "revoked" : "active",
      firstIssuedAt: index === 6 ? null : new Date(issued).toISOString(),
      learning: {
        readCount,
        totalCount: 40,
        startedAt: started ? new Date(issued + 5 * hour).toISOString() : null,
        lastActivityAt:
          started && readCount > 0
            ? new Date(issued + (20 + index) * hour).toISOString()
            : null,
      },
    };
  });
}

const storyNames = [
  "Анна Королёва",
  "Дмитрий Соколов",
  "Екатерина Константинопольская-Задунайская",
  null,
  "Михаил Орлов",
  "Ольга Смирнова",
  null,
  "Сергей Волков",
] as const;

/**
 * Подписи учеников для подставного чтения людей. Каждый восьмой ученик без контактов (его нет в
 * ответе), у одного только @username, у одного контакты временно не прочитались.
 */
export function storyHolderPeople(count: number): StoryPerson[] {
  return Array.from({ length: count }, (_, index) => index).flatMap(
    (index): StoryPerson[] => {
      if (index % 8 === 3) return [];
      const displayName = storyNames[index % storyNames.length] ?? null;
      return [
        {
          accountId: storyAccountId(index),
          displayName,
          username:
            index === 6 ? "only_username" : `learner_${String(index + 1)}`,
          email:
            index % 8 === 7 ? null : `learner${String(index + 1)}@example.test`,
          contactsState: index === 6 ? "partial" : "complete",
        },
      ];
    },
  );
}
