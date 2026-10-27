"use client";

import {
  BadgePercent,
  BookOpen,
  CreditCard,
  Ellipsis,
  ExternalLink,
  FileText,
  Funnel,
  Inbox,
  LayoutDashboard,
  Link2,
  Package,
  Tags,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  AuthoringSearchRoot,
  AuthoringSearchTrigger,
} from "@/features/authoring-search";
import { subscribeShellBreakpoint } from "@/shared/lib/shell-scroll";
import { authoringOverviewHref } from "@/shared/routing/authoring";
import { FullLoadLink } from "@/shared/ui/full-load-link.client";

import {
  authoringLocation,
  authoringMobileTabs,
  authoringMoreGroups,
  authoringNavigation,
  type AuthoringNavigationIcon,
  type AuthoringNavigationItem,
} from "../model/navigation";
import "./authoring-shell.css";

const icons: Record<AuthoringNavigationIcon, LucideIcon> = {
  overview: LayoutDashboard,
  products: Package,
  materials: FileText,
  topics: Tags,
  people: Users,
  submissions: Inbox,
  payments: CreditCard,
  "payment-links": Link2,
  discounts: BadgePercent,
  "sales-funnel": Funnel,
};

/**
 * Каркас админки (#1717, решения 2, 8 и 13). От 64rem — постоянная боковая панель с группами и
 * общим поиском сверху страницы; на телефоне — верхняя строка с названием раздела и поиском,
 * вкладки подразделов и нижняя панель «Обзор, Люди, Продажи, Сдачи, Ещё».
 *
 * `awaitingFeedbackCount` — число сдач без комментария автора для счётчика «Сдач». `null` — число
 * неизвестно: у аккаунта нет права на сдачи или чтение не удалось; тогда счётчика нет.
 */
export function AuthoringShell({
  awaitingFeedbackCount = null,
  children,
}: {
  readonly awaitingFeedbackCount?: number | null;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const location = authoringLocation(pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  // A retained shell closes the «Ещё» sheet when the destination changes.
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setMoreOpen(false);
  }
  useEffect(
    () =>
      // From 64rem the sidebar replaces the bottom panel, so an open sheet has nothing to belong to.
      subscribeShellBreakpoint((desktop) => {
        if (desktop) setMoreOpen(false);
      }),
    [],
  );
  // The sidebar names the preview in full; the narrow top row keeps one short word.
  const title = location.preview
    ? "Предпросмотр"
    : (location.item?.label ?? "Админка");
  const sectionTabs =
    location.atSectionRoot &&
    location.group !== undefined &&
    location.group.items.length > 1
      ? location.group
      : undefined;
  const moreCurrent = authoringMoreGroups.some((group) =>
    group.items.some((item) => item.id === location.item?.id),
  );

  return (
    <AuthoringSearchRoot>
      <div className="authoring-workspace" data-authoring-shell>
        <a className="authoring-skip" href="#authoring-content">
          Перейти к содержанию
        </a>
        <aside className="authoring-sidebar" aria-label="Админка">
          <Link className="authoring-brand" href={authoringOverviewHref}>
            <span className="authoring-brand-mark" aria-hidden="true">
              s.
            </span>
            <span>
              Sachkov Dev
              <span className="authoring-brand-caption">Админка</span>
            </span>
          </Link>
          <nav aria-label="Разделы админки" className="authoring-nav">
            {authoringNavigation.map((group) => (
              <div className="authoring-nav-group" key={group.id}>
                {group.label === null ? null : <p>{group.label}</p>}
                {group.items.map((item) => (
                  <NavigationLink
                    awaitingFeedbackCount={awaitingFeedbackCount}
                    current={item.id === location.item?.id}
                    item={item}
                    key={item.id}
                  />
                ))}
              </div>
            ))}
            {location.preview ? (
              <p className="authoring-preview-note" aria-current="page">
                Предпросмотр черновика
              </p>
            ) : null}
          </nav>
          <PublicLinks />
        </aside>
        <div className="authoring-main">
          <header className="authoring-topbar">
            <p className="authoring-topbar-title">{title}</p>
            <AuthoringSearchTrigger />
          </header>
          {sectionTabs === undefined ? null : (
            <nav
              aria-label={`Подразделы: ${sectionTabs.label ?? title}`}
              className="authoring-section-tabs"
            >
              {sectionTabs.items.map((item) => (
                <Link
                  {...counterLabel(item, awaitingFeedbackCount)}
                  aria-current={
                    item.id === location.item?.id ? "page" : undefined
                  }
                  href={item.href}
                  key={item.id}
                >
                  {item.label}
                  <Counter
                    awaitingFeedbackCount={awaitingFeedbackCount}
                    item={item}
                  />
                </Link>
              ))}
            </nav>
          )}
          {children}
        </div>
        <nav aria-label="Основные разделы" className="authoring-bottom-nav">
          {authoringMobileTabs.map(({ group, item }) => (
            <NavigationLink
              awaitingFeedbackCount={awaitingFeedbackCount}
              current={
                group === undefined
                  ? item.id === location.item?.id
                  : location.group?.id === group
              }
              item={item}
              key={item.id}
              variant="tab"
            />
          ))}
          <button
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className="authoring-tab"
            data-current={moreCurrent || undefined}
            onClick={() => {
              setMoreOpen(true);
            }}
            type="button"
          >
            <Ellipsis aria-hidden="true" className="authoring-tab-icon" />
            <span>Ещё</span>
          </button>
        </nav>
        <MoreSheet
          currentId={location.item?.id}
          onClose={() => {
            setMoreOpen(false);
          }}
          open={moreOpen}
        />
      </div>
    </AuthoringSearchRoot>
  );
}

function NavigationLink({
  awaitingFeedbackCount,
  current,
  item,
  variant = "sidebar",
  onNavigate,
}: {
  readonly awaitingFeedbackCount: number | null;
  readonly current: boolean;
  readonly item: AuthoringNavigationItem;
  readonly variant?: "sidebar" | "tab" | "sheet";
  readonly onNavigate?: () => void;
}) {
  const Icon = icons[item.icon];
  return (
    <Link
      {...counterLabel(item, awaitingFeedbackCount)}
      aria-current={current ? "page" : undefined}
      className={variant === "tab" ? "authoring-tab" : "authoring-nav-link"}
      href={item.href}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    >
      <Icon
        aria-hidden="true"
        className={
          variant === "tab" ? "authoring-tab-icon" : "authoring-nav-icon"
        }
      />
      <span className="authoring-nav-label">{item.label}</span>
      <Counter awaitingFeedbackCount={awaitingFeedbackCount} item={item} />
    </Link>
  );
}

/** Число у пункта со счётчиком; `null` — счётчика нет или он пуст. */
function counterValue(
  item: AuthoringNavigationItem,
  awaitingFeedbackCount: number | null,
): number | null {
  return item.counter === "submissions-awaiting-feedback" &&
    awaitingFeedbackCount !== null &&
    awaitingFeedbackCount > 0
    ? awaitingFeedbackCount
    : null;
}

/** Доступное имя пункта: число счётчика названо словами, а не одной цифрой. */
function counterLabel(
  item: AuthoringNavigationItem,
  awaitingFeedbackCount: number | null,
): { readonly "aria-label"?: string } {
  const count = counterValue(item, awaitingFeedbackCount);
  return count === null
    ? {}
    : { "aria-label": `${item.label}, без комментария: ${String(count)}` };
}

/** Счётчик сдач без комментария: видимое число, «99+» сверх двух знаков. */
function Counter({
  awaitingFeedbackCount,
  item,
}: {
  readonly awaitingFeedbackCount: number | null;
  readonly item: AuthoringNavigationItem;
}) {
  const count = counterValue(item, awaitingFeedbackCount);
  if (count === null) return null;
  return (
    <span aria-hidden="true" className="authoring-nav-count" data-nav-counter>
      {count > 99 ? "99+" : String(count)}
    </span>
  );
}

function PublicLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  const navigate = onNavigate === undefined ? {} : { onClick: onNavigate };
  return (
    <div className="authoring-public-links">
      <FullLoadLink href="/" {...navigate}>
        <BookOpen aria-hidden="true" className="authoring-nav-icon" />
        Библиотека материалов
      </FullLoadLink>
      <FullLoadLink href="/" {...navigate}>
        <ExternalLink aria-hidden="true" className="authoring-nav-icon" />
        На публичный сайт
      </FullLoadLink>
    </div>
  );
}

/**
 * Лист «Ещё»: разделы, которых нет в нижней панели, и ссылки на сайт. Модальное окно браузера
 * держит фокус внутри и закрывается по Escape; закрытие возвращает фокус на «Ещё».
 */
function MoreSheet({
  currentId,
  onClose,
  open,
}: {
  readonly currentId: string | undefined;
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      aria-labelledby="authoring-more-title"
      className="authoring-more-sheet"
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={onClose}
      onKeyDown={(event) => {
        // Synthetic and assistive Escape presses do not always reach the native cancel.
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      ref={dialog}
    >
      <div className="authoring-more-body">
        <header className="authoring-more-header">
          <h2 id="authoring-more-title">Ещё</h2>
          <button
            aria-label="Закрыть"
            className="authoring-more-close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <nav aria-label="Другие разделы">
          {authoringMoreGroups.map((group) => (
            <div className="authoring-nav-group" key={group.id}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <NavigationLink
                  awaitingFeedbackCount={null}
                  current={item.id === currentId}
                  item={item}
                  key={item.id}
                  onNavigate={onClose}
                  variant="sheet"
                />
              ))}
            </div>
          ))}
        </nav>
        <PublicLinks onNavigate={onClose} />
      </div>
    </dialog>
  );
}
