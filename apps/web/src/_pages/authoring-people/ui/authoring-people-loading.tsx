import {
  AdminFilterBarSkeleton,
  AdminListHeader,
  AdminTableSkeleton,
} from "@/shared/ui/admin";

import {
  AuthoringPeopleFrame,
  peopleFilterCount,
  peopleTableColumnCount,
} from "./authoring-people-frame";

/**
 * Список людей, пока данные идут: настоящий заголовок, строка фильтров и таблица в своей
 * геометрии. Пришедший список не сдвигает ни заголовок, ни начало таблицы.
 */
export function AuthoringPeopleLoading() {
  return (
    <AuthoringPeopleFrame busy label="Загрузка списка людей">
      <AdminListHeader count="Загрузка…" title="Люди" />
      <section
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        data-authoring-people-list
      >
        <AdminFilterBarSkeleton filters={peopleFilterCount} />
        <AdminTableSkeleton
          columns={peopleTableColumnCount}
          label="Загружаем людей"
        />
      </section>
    </AuthoringPeopleFrame>
  );
}
