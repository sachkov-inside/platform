import type { ReactNode } from "react";

import { hasText } from "@/shared/lib/text";

import "./admin.css";

/** Заголовок списка: название, число записей рядом и одна главная кнопка создания справа. */
export function AdminListHeader({
  title,
  count,
  action,
  headingId,
}: {
  readonly title: string;
  /** «12 материалов». */
  readonly count?: string;
  readonly action?: ReactNode;
  readonly headingId?: string;
}) {
  return (
    <header className="admin-list-header">
      <div className="admin-list-header-titles">
        <h1 id={headingId}>{title}</h1>
        {hasText(count) ? (
          <p className="admin-list-header-count">{count}</p>
        ) : null}
      </div>
      {action === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </header>
  );
}
