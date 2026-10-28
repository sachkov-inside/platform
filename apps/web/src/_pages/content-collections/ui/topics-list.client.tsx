"use client";

import type { Route } from "next";

import {
  AdminRowMenu,
  AdminTable,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";

import type { TopicListRow } from "../model/collection-list";

const topicColumns: readonly AdminTableColumn<TopicListRow>[] = [
  { id: "name", header: "Название", cell: (row) => row.caption },
  {
    id: "state",
    header: "Состояние",
    width: "8rem",
    cell: (row) => <StateBadge state={row.state} />,
  },
  {
    id: "materials",
    header: "Опубликовано",
    width: "9rem",
    align: "end",
    cell: (row) => row.materials,
  },
];

/** Таблица тем: строка открывает тему на этой же странице, «⋯» правит и убирает в архив. */
export function TopicsTable({
  rows,
  rowHref,
  onOpen,
  onArchive,
  archivePending,
}: {
  readonly rows: readonly TopicListRow[];
  /** Адрес темы `?topic=` для новой вкладки; обычный щелчок открывает её без перехода. */
  readonly rowHref: (row: TopicListRow) => Route;
  readonly onOpen: (row: TopicListRow) => void;
  readonly onArchive: (row: TopicListRow) => void;
  readonly archivePending: boolean;
}) {
  return (
    <AdminTable
      caption="Все темы"
      columns={topicColumns}
      mobileItem={(row) => ({
        title: row.name,
        caption: row.caption,
        badge: <StateBadge state={row.state} />,
        metric: `Опубликовано: ${row.materials}`,
      })}
      onRowOpen={onOpen}
      rowActions={(row) => (
        <AdminRowMenu
          items={[
            {
              id: "edit",
              label: "Изменить",
              onSelect: () => {
                onOpen(row);
              },
            },
            {
              id: "archive",
              label: row.archived ? "Вернуть из архива" : "В архив",
              disabled: archivePending,
              onSelect: () => {
                onArchive(row);
              },
            },
          ]}
          label={`Действия с «${row.name}»`}
        />
      )}
      rowHref={rowHref}
      rowKey={(row) => row.id}
      rows={rows}
      rowTitle={(row) => row.name}
    />
  );
}
