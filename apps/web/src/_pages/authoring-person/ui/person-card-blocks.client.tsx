"use client";

import Link from "next/link";

import { personPaymentsHref } from "@/features/owner-payments";
import {
  formatMoscowDate,
  formatMoscowDateTime,
  formatRubles,
} from "@/shared/lib/moscow-format";
import { authoringPaymentHref } from "@/shared/routing/authoring";
import {
  AdminTable,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type {
  PersonCard,
  PersonCardLearning,
  PersonCardPayment,
  PersonCardSubmission,
  PersonCardWaitlist,
} from "../model/person-card";
import {
  learningActivityText,
  learningProgressText,
  learningStartText,
  paidLinks,
  paymentStateText,
  productNameOf,
  submissionsText,
  telegramFacts,
  telegramObservedText,
} from "../model/person-card-presentation";
import { BlockNote, BlockUnavailable } from "./person-card-section";

const paymentColumns: readonly AdminTableColumn<PersonCardPayment>[] = [
  {
    cell: (payment) =>
      payment.paymentLinkId === null ? null : "По ссылке на оплату",
    header: "Продукт",
    id: "product",
  },
  {
    cell: (payment) => paymentStateText(payment.state),
    header: "Состояние",
    id: "state",
    width: "13rem",
  },
  {
    align: "end",
    cell: (payment) => formatRubles(payment.amountKopecks),
    header: "Сумма",
    id: "amount",
    width: "9rem",
  },
  {
    cell: (payment) => (
      <time className="tabular-nums" dateTime={payment.createdAt}>
        {formatMoscowDateTime(payment.createdAt)}
      </time>
    ),
    header: "Время",
    id: "createdAt",
    width: "12rem",
  },
];

function paymentTitle(payment: PersonCardPayment): string {
  return payment.productName ?? "Продукт не указан";
}

/**
 * Последние оплаты человека, новые сверху, и ссылки на оплату, по которым он платил. Строка ведёт
 * на страницу платежа, а «Все оплаты» в список платежей с фильтром по этому человеку: карточка
 * читает только последние оплаты. Order Email здесь нет.
 */
export function PersonPaymentsBlock({
  accountId,
  onRetry,
  payments,
}: {
  readonly accountId: string;
  readonly onRetry: () => void;
  readonly payments: PersonCard["payments"];
}) {
  if (payments.state === "unavailable")
    return <BlockUnavailable onRetry={onRetry} subject="Оплаты" />;
  if (payments.items.length === 0)
    return <BlockNote>Оплат пока не было.</BlockNote>;
  const links = paidLinks(payments);
  return (
    <>
      <AdminTable
        caption="Оплаты человека"
        columns={paymentColumns}
        mobileItem={(payment) => ({
          caption: paymentStateText(payment.state),
          metric: (
            <span className="tabular-nums">
              {formatRubles(payment.amountKopecks)} ·{" "}
              <time dateTime={payment.createdAt}>
                {formatMoscowDate(payment.createdAt)}
              </time>
            </span>
          ),
          title: paymentTitle(payment),
        })}
        rowHref={(payment) => authoringPaymentHref(payment.paymentId)}
        rowKey={(payment) => payment.paymentId}
        rowTitle={paymentTitle}
        rows={payments.items}
      />
      <p className="m-0">
        <Button asChild className="min-h-11 px-4" variant="outline">
          <Link href={personPaymentsHref(accountId)}>Все оплаты</Link>
        </Button>
      </p>
      <div className="person-card-panel">
        <h3>Ссылки, по которым человек оплатил</h3>
        {links.length === 0 ? (
          <BlockNote>Человек не платил по ссылке на оплату.</BlockNote>
        ) : (
          <ul className="grid gap-1 text-sm">
            {links.map((payment) => (
              <li key={payment.paymentId}>
                Ссылка на оплату «{paymentTitle(payment)}»,{" "}
                <span className="tabular-nums">
                  {formatRubles(payment.amountKopecks)}
                </span>
                ,{" "}
                <time dateTime={payment.createdAt}>
                  {formatMoscowDate(payment.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * Обучение по продуктам: начало, прогресс, последняя активность и сдачи. Email рядом со сдачами
 * не показывается (privacy-v6); без права на материалы блок сдач говорит об этом спокойно.
 */
export function PersonLearningBlock({
  card,
  onRetry,
}: {
  readonly card: PersonCard;
  readonly onRetry: () => void;
}) {
  const { learning, submissions } = card;
  return (
    <>
      {learning.state === "unavailable" ? (
        <BlockUnavailable onRetry={onRetry} subject="Обучение" />
      ) : learning.items.length === 0 ? (
        <BlockNote>
          Человек ещё не начал обучение ни в одном продукте.
        </BlockNote>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {learning.items.map((item) => (
            <li key={item.productId}>
              <LearningPanel
                learning={item}
                submission={
                  submissions.state === "ready"
                    ? submissions.items.find(
                        (entry) => entry.productId === item.productId,
                      )
                    : undefined
                }
                submissionsState={submissions.state}
              />
            </li>
          ))}
        </ul>
      )}
      <SubmissionsSummary card={card} onRetry={onRetry} />
    </>
  );
}

function LearningPanel({
  learning,
  submission,
  submissionsState,
}: {
  readonly learning: PersonCardLearning;
  readonly submission: PersonCardSubmission | undefined;
  readonly submissionsState: PersonCard["submissions"]["state"];
}) {
  const progress = learning.progress;
  const share =
    progress.state === "measured" && progress.total > 0
      ? Math.min(1, progress.read / progress.total)
      : null;
  const activity = learningActivityText(learning);
  return (
    <article className="person-card-panel">
      <h3>{learning.name}</h3>
      <p className="m-0 text-sm text-muted-foreground">
        {learningStartText(learning)}
      </p>
      <p className="m-0 text-sm">{learningProgressText(learning)}</p>
      {share === null ? null : (
        <div aria-hidden="true" className="person-card-progress">
          <span style={{ width: `${String(Math.round(share * 100))}%` }} />
        </div>
      )}
      {activity === "" ? null : (
        <p className="m-0 text-sm text-muted-foreground">{activity}</p>
      )}
      {submissionsState === "ready" ? (
        <p className="m-0 text-sm">
          {submission === undefined
            ? "Сдач пока нет"
            : submissionsText(submission)}
        </p>
      ) : null}
    </article>
  );
}

/** Сдачи по продуктам, которых нет в обучении, и состояния блока сдач целиком. */
function SubmissionsSummary({
  card,
  onRetry,
}: {
  readonly card: PersonCard;
  readonly onRetry: () => void;
}) {
  const { learning, submissions } = card;
  if (submissions.state === "forbidden")
    return (
      <BlockNote>Сдачи видит аккаунт с правом управлять материалами.</BlockNote>
    );
  if (submissions.state === "unavailable")
    return <BlockUnavailable onRetry={onRetry} subject="Сдачи" />;
  const listed =
    learning.state === "ready"
      ? new Set(learning.items.map((item) => item.productId))
      : new Set<string>();
  const rest = submissions.items.filter((item) => !listed.has(item.productId));
  if (rest.length === 0) return null;
  return (
    <div className="person-card-panel">
      <h3>Сдачи</h3>
      <ul className="grid gap-1 text-sm">
        {rest.map((item) => (
          <li key={item.productId}>
            {productNameOf(card, item.productId)}: {submissionsText(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Telegram: связь, группа, ограничения и рассылка; неизвестное остаётся неизвестным. */
export function PersonTelegramBlock({
  onRetry,
  telegram,
}: {
  readonly onRetry: () => void;
  readonly telegram: PersonCard["telegram"];
}) {
  if (telegram.state === "unavailable")
    return <BlockUnavailable onRetry={onRetry} subject="Данные Telegram" />;
  return (
    <div className="person-card-panel">
      <dl className="person-card-facts-list">
        {telegramFacts(telegram).map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              <StateBadge state={fact.state} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-sm text-muted-foreground">
        {telegramObservedText(telegram.observedAt)}
      </p>
    </div>
  );
}

const waitlistColumns: readonly AdminTableColumn<PersonCardWaitlist>[] = [
  { cell: (entry) => entry.intakeName, header: "Список", id: "intake" },
  {
    cell: (entry) => (
      <StateBadge
        state={entry.active ? "waitlist.active" : "waitlist.inactive"}
      />
    ),
    header: "Состояние",
    id: "state",
    width: "11rem",
  },
  {
    cell: (entry) => (
      <time className="tabular-nums" dateTime={entry.joinedAt}>
        {formatMoscowDate(entry.joinedAt)}
      </time>
    ),
    header: "Записался",
    id: "joinedAt",
    width: "9rem",
  },
];

export function PersonWaitlistsBlock({
  onRetry,
  waitlists,
}: {
  readonly onRetry: () => void;
  readonly waitlists: PersonCard["waitlists"];
}) {
  if (waitlists.state === "unavailable")
    return <BlockUnavailable onRetry={onRetry} subject="Списки ожидания" />;
  if (waitlists.items.length === 0)
    return <BlockNote>Человек не записывался в списки ожидания.</BlockNote>;
  return (
    <AdminTable
      caption="Списки ожидания человека"
      columns={waitlistColumns}
      mobileItem={(entry) => ({
        badge: (
          <StateBadge
            state={entry.active ? "waitlist.active" : "waitlist.inactive"}
          />
        ),
        caption: entry.intakeName,
        metric: (
          <time dateTime={entry.joinedAt}>
            {formatMoscowDate(entry.joinedAt)}
          </time>
        ),
        title: entry.productName ?? "Продукт",
      })}
      rowKey={(entry) => `${entry.productId}-${entry.intakeName}`}
      rowTitle={(entry) => entry.productName ?? "Продукт"}
      rows={waitlists.items}
    />
  );
}
