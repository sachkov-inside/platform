import type { Route } from "next";
import Link from "next/link";

import type { AcceptedDocumentsState } from "../model/accepted-documents";

export interface AcceptedDocumentsPanelProps {
  readonly state: AcceptedDocumentsState;
  /** Действующие редакции документов о данных: их не принимают, а читают. */
  readonly policies: readonly {
    readonly label: string;
    readonly href: Route;
  }[];
}

/**
 * Блок «Принятые документы» в разделе «Аккаунт»: условия, оферты и автопродление — с датой,
 * редакцией и подписью нажатой кнопки. Отзывать здесь нечего: автопродление отключается
 * в разделе «Подписка», сообщения бота — командой /stop.
 */
export function AcceptedDocumentsPanel({
  state,
  policies,
}: AcceptedDocumentsPanelProps) {
  return (
    <section
      aria-labelledby="accepted-documents"
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <h2 className="text-xl font-semibold" id="accepted-documents">
        Принятые документы
      </h2>
      {state.kind === "loading" ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Загружаем принятые документы…
        </p>
      ) : state.kind === "unavailable" ? (
        <p className="mt-3 text-sm leading-6" role="alert">
          Список принятых документов сейчас недоступен. Сами принятия сохранены.
        </p>
      ) : state.items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Здесь появятся документы, которые вы примете.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {state.items.map((item) => (
            <li className="py-4" key={item.key}>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                {item.acceptedAt}
                {item.buttonLabel === null
                  ? null
                  : ` · кнопка «${item.buttonLabel}»`}
                {" · "}
                {item.href === null ? (
                  item.edition
                ) : (
                  <Link
                    className="text-action underline underline-offset-4"
                    href={item.href}
                  >
                    {item.edition}
                  </Link>
                )}
              </p>
              {item.shownTerms === null ? null : (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Показанные условия: {item.shownTerms}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {policies.length === 0 ? null : (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Как обрабатываются данные:{" "}
          {policies.map((policy, index) => (
            <span key={policy.href}>
              {index === 0 ? null : " · "}
              <Link
                className="text-action underline underline-offset-4"
                href={policy.href}
              >
                {policy.label}
              </Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
