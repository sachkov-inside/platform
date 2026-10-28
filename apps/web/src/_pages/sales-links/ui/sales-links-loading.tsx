import {
  AdminFilterBarSkeleton,
  AdminListHeader,
  AdminTableSkeleton,
} from "@/shared/ui/admin";

import { SalesLinksFrame } from "./sales-links-frame";

/** Страница ссылок, пока читается адрес: заголовок, фильтры и таблица в своей геометрии. */
export function SalesLinksLoading() {
  return (
    <SalesLinksFrame busy>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <AdminListHeader count="Новые сверху" title="Ссылки на оплату" />
        <AdminFilterBarSkeleton filters={2} search={false} />
        <AdminTableSkeleton columns={5} label="Загружаем ссылки" />
      </div>
    </SalesLinksFrame>
  );
}
