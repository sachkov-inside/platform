"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

import "./admin.css";

export interface AdminTableColumn<Row> {
  readonly id: string;
  /** Видимый заголовок колонки; он же её доступное имя. */
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  /** Числа и суммы: `"end"` и табличные цифры. */
  readonly align?: "start" | "end";
  /** Ширина CSS, например `"8rem"`. Первая колонка без ширины забирает остаток. */
  readonly width?: string;
}

/** Строка на телефоне: заголовок, подстрока, плашка и одно ключевое число. */
export interface AdminTableMobileItem {
  readonly title: ReactNode;
  readonly caption?: ReactNode;
  readonly badge?: ReactNode;
  readonly metric?: ReactNode;
}

export interface AdminTableProps<Row> {
  /** Доступное имя таблицы и списка. */
  readonly caption: string;
  /** 4–6 колонок. Первая колонка показывает `rowTitle` и подстроку из своей `cell`. */
  readonly columns: readonly AdminTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Адрес объекта строки: щелчок по любому месту строки открывает его. */
  readonly rowHref?: (row: Row) => Route;
  /** Текст настоящей ссылки строки в первой колонке. */
  readonly rowTitle: (row: Row) => ReactNode;
  /**
   * Открывает объект на той же странице, например панель по адресу `?topic=`, вместо перехода Next:
   * его вызывают щелчок по строке и обычный щелчок по её ссылке. Ссылка `rowHref` остаётся для
   * новой вкладки. Без `rowHref` у объекта нет своего адреса (диалог подробностей): название
   * строки становится кнопкой, которая открывает его так же.
   */
  readonly onRowOpen?: (row: Row) => void;
  /** Картинка перед названием в первой колонке таблицы, например обложка; в телефонном списке её нет. */
  readonly rowMedia?: (row: Row) => ReactNode;
  /** Не больше одного прямого действия и всегда видимое «⋯» (`AdminRowMenu`). */
  readonly rowActions?: (row: Row) => ReactNode;
  /** Ширина колонки действий; по умолчанию под одно «⋯». */
  readonly actionsWidth?: string;
  readonly mobileItem: (row: Row) => AdminTableMobileItem;
  /** Идёт повторное чтение: строки тускнеют, разметка не прыгает. */
  readonly busy?: boolean;
}

const interactiveDescendant =
  "a, button, input, select, textarea, label, summary, [role=menuitem], [role=menu], [data-row-action]";

/**
 * Плотная таблица списка админки. С ширины колонки 40rem это семантическая `<table>`, в более узкой
 * список `<ul>`; в дереве доступности всегда ровно одна из них, вторая скрыта CSS. Строку открывает
 * настоящая ссылка в первой колонке, а щелчок по остальной строке повторяет её переход.
 *
 * Обе раскладки рендерятся сразу, поэтому `rowActions` и ячейки рендерятся дважды: диалоги
 * действий держит страница, а не ячейка, и `id` внутри ячеек не используются.
 */
export function AdminTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  rowTitle,
  onRowOpen,
  rowMedia,
  rowActions,
  actionsWidth = "3.5rem",
  mobileItem,
  busy = false,
}: AdminTableProps<Row>) {
  const router = useRouter();
  const [first, ...rest] = columns;

  const openRow = (
    event: MouseEvent<HTMLElement>,
    href: Route | undefined,
    row: Row,
  ) => {
    if (event.defaultPrevented) return;
    if (href === undefined && onRowOpen === undefined) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target;
    // Щелчок из портала (меню, диалог) всплывает по дереву React, но не по DOM строки.
    if (!(target instanceof Element) || !event.currentTarget.contains(target))
      return;
    if (target.closest(interactiveDescendant) !== null) return;
    // Выделение текста мышью не переход.
    if (hasTextSelection()) return;
    if (onRowOpen !== undefined) onRowOpen(row);
    else if (href !== undefined) router.push(href);
  };
  const titleOpener = (row: Row) =>
    onRowOpen === undefined
      ? undefined
      : () => {
          onRowOpen(row);
        };

  return (
    <div aria-busy={busy} className="admin-table-root">
      <table className="admin-table">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.id}
              style={
                column.width === undefined ? undefined : { width: column.width }
              }
            />
          ))}
          {rowActions === undefined ? null : (
            <col style={{ width: actionsWidth }} />
          )}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                data-align={column.align ?? "start"}
                key={column.id}
                scope="col"
              >
                {column.header}
              </th>
            ))}
            {rowActions === undefined ? null : (
              <th data-actions="" scope="col">
                <span className="sr-only">Действия</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                data-href={href}
                data-opens={onRowOpen === undefined ? undefined : ""}
                key={rowKey(row)}
                onClick={(event) => {
                  openRow(event, href, row);
                }}
              >
                {first === undefined ? null : (
                  <td data-align={first.align ?? "start"}>
                    <TitleCell media={rowMedia?.(row)}>
                      <div className="admin-cell-title">
                        <RowTitle href={href} onOpen={titleOpener(row)}>
                          {rowTitle(row)}
                        </RowTitle>
                        {renderCaption(first.cell(row))}
                      </div>
                    </TitleCell>
                  </td>
                )}
                {rest.map((column) => (
                  <td data-align={column.align ?? "start"} key={column.id}>
                    {column.cell(row)}
                  </td>
                ))}
                {rowActions === undefined ? null : (
                  <td data-actions="">
                    <div className="admin-row-actions">{rowActions(row)}</div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul aria-label={caption} className="admin-list">
        {rows.map((row) => {
          const href = rowHref?.(row);
          const item = mobileItem(row);
          const hasMeta = item.badge !== undefined || item.metric !== undefined;
          return (
            <li
              className="admin-list-item"
              data-href={href}
              data-opens={onRowOpen === undefined ? undefined : ""}
              key={rowKey(row)}
              onClick={(event) => {
                openRow(event, href, row);
              }}
            >
              <div className="admin-list-item-main">
                <span className="admin-list-item-title">
                  <RowTitle href={href} onOpen={titleOpener(row)}>
                    {item.title}
                  </RowTitle>
                </span>
                {item.caption === undefined ? null : (
                  <span className="admin-list-item-caption">
                    {item.caption}
                  </span>
                )}
                {hasMeta ? (
                  <span className="admin-list-item-meta">
                    {item.badge ?? null}
                    {item.metric === undefined ? null : (
                      <span className="admin-list-item-metric">
                        {item.metric}
                      </span>
                    )}
                  </span>
                ) : null}
              </div>
              {rowActions === undefined ? null : (
                <div className="admin-row-actions">{rowActions(row)}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RowTitle({
  href,
  onOpen,
  children,
}: {
  readonly href: Route | undefined;
  readonly onOpen: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  if (href === undefined)
    return onOpen === undefined ? (
      <span className="font-semibold">{children}</span>
    ) : (
      <button
        className="admin-row-link admin-row-button"
        onClick={onOpen}
        type="button"
      >
        {children}
      </button>
    );
  return (
    <Link
      className="admin-row-link"
      href={href}
      onClick={(event) => {
        if (onOpen === undefined || event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        // Link не переходит, когда его щелчок отменён: объект открывает страница.
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
    </Link>
  );
}

function TitleCell({
  media,
  children,
}: {
  readonly media: ReactNode;
  readonly children: ReactNode;
}) {
  if (media === null || media === undefined || media === false) return children;
  return (
    <div className="admin-cell-with-media">
      <span aria-hidden="true" className="admin-cell-media">
        {media}
      </span>
      {children}
    </div>
  );
}

function renderCaption(caption: ReactNode) {
  if (caption === null || caption === undefined || caption === "") return null;
  return <span className="admin-cell-caption">{caption}</span>;
}

function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}
