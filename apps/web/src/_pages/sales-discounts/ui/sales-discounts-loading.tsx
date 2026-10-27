import {
  AdminFilterBarSkeleton,
  AdminListHeader,
  AdminTableSkeleton,
} from "@/shared/ui/admin";

import { SalesDiscountsFrame } from "./sales-discounts-frame";

/** «Скидки», пока читается адрес: заголовок, подразделы, фильтры и таблица в своей геометрии. */
export function SalesDiscountsLoading() {
  return (
    <SalesDiscountsFrame busy>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <AdminListHeader title="Скидки" />
        <div aria-hidden="true" className="min-h-11" />
        <AdminFilterBarSkeleton filters={2} search={false} />
        <AdminTableSkeleton columns={7} label="Загружаем скидки" />
      </div>
    </SalesDiscountsFrame>
  );
}
