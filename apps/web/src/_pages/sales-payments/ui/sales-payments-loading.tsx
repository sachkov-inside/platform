import { AdminTableSkeleton } from "@/shared/ui/admin";

import { SalesPaymentsFrame } from "./sales-payments-frame";

/**
 * «Платежи», пока страница читает адрес: тот же каркас и заголовок, место полей фильтра и таблица
 * в своей геометрии.
 */
export function SalesPaymentsLoading() {
  return (
    <SalesPaymentsFrame busy>
      <div aria-hidden="true" className="grid gap-3">
        <span className="admin-skeleton-bar block h-[4.75rem] w-full max-w-[42rem]" />
        <span className="admin-skeleton-bar block h-11 w-full max-w-[13rem]" />
      </div>
      <AdminTableSkeleton columns={6} label="Загружаем платежи" />
    </SalesPaymentsFrame>
  );
}
