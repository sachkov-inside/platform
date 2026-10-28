import {
  CreditCard,
  FileText,
  KeyRound,
  RotateCcw,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { formatMoscowDateTime } from "@/shared/lib/moscow-format";

import {
  overviewEventRow,
  type OverviewEventRow,
} from "../model/event-presentation";
import type { OverviewEvent } from "../model/overview-contract";

import "./admin-overview.css";

const icons: Readonly<Record<OverviewEvent["kind"], LucideIcon>> = {
  payment_confirmed: CreditCard,
  access_issued: KeyRound,
  access_revoked: ShieldOff,
  access_restored: RotateCcw,
  submission: FileText,
};

/**
 * Последние события новыми сверху: что случилось, с кем, с каким продуктом и когда. Человек
 * ссылается на свою карточку, только когда зритель может ее открыть.
 */
export function OverviewEventList({
  events,
  label,
  peopleLinks,
}: {
  readonly events: readonly OverviewEvent[];
  /** Доступное имя списка. */
  readonly label: string;
  readonly peopleLinks: boolean;
}) {
  return (
    <ol aria-label={label} className="admin-events">
      {events.map((event) => {
        const row = overviewEventRow(event, { peopleLinks });
        return (
          <li key={row.key}>
            <EventRow row={row} />
          </li>
        );
      })}
    </ol>
  );
}

function EventRow({ row }: { readonly row: OverviewEventRow }) {
  const Icon = icons[row.kind];
  return (
    <article className="admin-event" data-kind={row.kind}>
      <span aria-hidden="true" className="admin-event-icon">
        <Icon />
      </span>
      <p className="admin-event-title m-0">
        {row.href === null ? (
          row.title
        ) : (
          <Link className="admin-overview-link" href={row.href}>
            {row.title}
          </Link>
        )}
        {row.detail === null ? null : <span>{` · ${row.detail}`}</span>}
      </p>
      <p className="admin-event-context m-0">
        {row.person.href === null ? (
          <span className={row.person.named ? "text-foreground" : undefined}>
            {row.person.label}
          </span>
        ) : (
          <Link href={row.person.href}>{row.person.label}</Link>
        )}
        {row.product === null ? null : (
          <>
            {" · "}
            <Link href={row.product.href}>{row.product.name}</Link>
          </>
        )}
      </p>
      <time className="admin-event-time" dateTime={row.occurredAt}>
        {formatMoscowDateTime(row.occurredAt)}
      </time>
    </article>
  );
}
