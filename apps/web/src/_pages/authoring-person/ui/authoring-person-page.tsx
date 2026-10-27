import { AuthoringPersonLoading } from "./authoring-person-loading";
import { AuthoringPersonQuery } from "./authoring-person-query.client";

export { AuthoringPersonLoading };

/**
 * `/authoring/people/[accountId]`: карточка читается в браузере одним запросом TanStack Query,
 * чтобы действие с доступом и «Обновить данные» перечитывали тот же ключ.
 */
export function AuthoringPersonPage({
  accountId,
}: {
  readonly accountId: string;
}) {
  return <AuthoringPersonQuery accountId={accountId} />;
}
