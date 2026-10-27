import { AdminErrorState, AdminListHeader } from "@/shared/ui/admin";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";

import type { ContentCollectionKind } from "../model/content-collections";

/**
 * Список тем или продуктов не прочитан: заголовок списка остаётся, ниже причина, код обращения и
 * повтор, который перечитывает страницу с сервера.
 */
export function ContentCollectionsUnavailable({
  kind,
  reference,
}: {
  readonly kind: ContentCollectionKind;
  readonly reference: string;
}) {
  return (
    <main className="authoring-page" id="authoring-content" tabIndex={-1}>
      <div className="authoring-page-body">
        <AdminListHeader title={kind === "topic" ? "Темы" : "Продукты"} />
        <AdminErrorState
          description={
            kind === "topic"
              ? "Не удалось прочитать темы. Повторите через минуту; если не поможет, сообщите код обращения."
              : "Не удалось прочитать продукты. Повторите через минуту; если не поможет, сообщите код обращения."
          }
          reference={reference}
          retry={<RetryPageButton />}
          title="Список временно недоступен"
        />
      </div>
    </main>
  );
}
