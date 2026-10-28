import { personLabel, type PersonLabel } from "./person-identity";
import type { PersonIdentitiesView } from "./use-people-reads.client";

/**
 * Подпись человека в строке чужого списка (ученики, платежи) по одному чтению
 * `usePersonIdentities` на страницу. Заголовок никогда не UUID: пока подписи читаются, при отказе,
 * сбое или для аккаунта без контактов вместо имени стоит нейтральный текст `missing`.
 */
export function personRowLabel(
  view: PersonIdentitiesView,
  accountId: string,
): PersonLabel {
  switch (view.kind) {
    case "loading":
      return { title: null, missing: "Загружаем контакты", context: [] };
    case "forbidden":
      return { title: null, missing: "Контакты скрыты", context: [] };
    case "signed_out":
    case "unavailable":
      return {
        title: null,
        missing: "Контакты временно недоступны",
        context: [],
      };
    case "ready": {
      const identity = view.byId.get(accountId.toLowerCase());
      return identity === undefined
        ? { title: null, missing: "Аккаунт без контактов", context: [] }
        : personLabel(identity);
    }
  }
}
