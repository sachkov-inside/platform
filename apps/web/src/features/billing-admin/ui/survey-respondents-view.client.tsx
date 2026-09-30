"use client";
import { Button } from "@/shared/ui/button";
import { hasText } from "@/shared/lib/text";

import {
  respondentLinkUrl,
  type RespondentImport,
  type RespondentLink,
  type RespondentsView,
} from "../model/respondent-operations";
import {
  AdminField,
  AdminSection,
  AdminTextArea,
  formText,
  onAdminSubmit,
} from "./admin-form.client";

export interface IssueRespondentLinkInput {
  readonly username: string;
  readonly templatePromotionId: string;
}

export interface SurveyRespondentsViewProps {
  readonly data: RespondentsView | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly message: string;
  readonly imported: RespondentImport | null;
  readonly link: RespondentLink | null;
  /** Адрес платформы, на котором собирается ссылка для отправки. */
  readonly origin: string;
  readonly onRefresh: () => void;
  readonly onImport: (list: string) => void;
  readonly onIssue: (input: IssueRespondentLinkInput) => void;
  readonly onCopy: (text: string) => void;
}

const issuedDate = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "Europe/Moscow",
});

/**
 * Скидка респондентам анкеты: колонка анкеты загружается списком, а человеку, который написал
 * владельцу, выдаётся личная одноразовая ссылка. Проверку ника и одноразовость держит Platform.
 */
export function SurveyRespondentsView(props: SurveyRespondentsViewProps) {
  const url =
    props.link === null ? null : respondentLinkUrl(props.link, props.origin);
  return (
    <AdminSection
      title="Скидка респондентам анкеты"
      description="Список ников хранится только в базе платформы. Журнал владельца записывает загрузку и выдачу без ников."
    >
      <div className="flex flex-wrap gap-3">
        <Button onClick={props.onRefresh} variant="outline">
          Обновить список
        </Button>
      </div>
      {props.loading ? <p role="status">Загружаем список…</p> : null}
      {hasText(props.error) ? <p role="alert">{props.error}</p> : null}
      {props.data === null ? null : (
        <dl className="grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">В списке</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {props.data.total}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ссылок выдано</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {props.data.issued}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Купили по ссылке</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {props.data.purchased}
            </dd>
          </div>
        </dl>
      )}
      <p aria-live="polite" className="break-words text-sm" role="status">
        {props.message}
      </p>

      <form
        className="grid gap-4"
        onSubmit={onAdminSubmit((form) => {
          props.onIssue({
            username: formText(form.get("respondentUsername")),
            templatePromotionId: formText(form.get("respondentTemplate")),
          });
        })}
      >
        <h3 className="font-semibold">Выдать ссылку человеку</h3>
        <AdminField
          autoComplete="off"
          hint="Как в сообщении: @nick, nick или ссылка t.me."
          label="Telegram-ник"
          name="respondentUsername"
          required
        />
        <AdminField
          autoComplete="off"
          hint="Идентификатор архивной скидки из раздела «Скидка». Её процент, срок и предложения получит личный одноразовый код."
          label="Шаблон скидки"
          name="respondentTemplate"
          required
        />
        <p>
          <Button disabled={props.busy} type="submit">
            Выдать ссылку
          </Button>
        </p>
      </form>
      {props.link === null ? null : (
        <div className="grid gap-3 rounded-xl border border-border bg-muted/50 p-4 text-sm">
          <p className="font-semibold">
            {props.link.alreadyIssued
              ? "Этому нику ссылка уже выдана — вот прежняя."
              : "Ссылка готова. Она сработает один раз."}
          </p>
          <p className="break-all font-mono">{url ?? props.link.code}</p>
          {url === null ? (
            <p className="text-muted-foreground">
              Скидка относится не к одному продукту, поэтому отправьте код и
              адрес страницы оплаты.
            </p>
          ) : null}
          <p>
            <Button
              onClick={() => {
                props.onCopy(url ?? props.link?.code ?? "");
              }}
              type="button"
              variant="outline"
            >
              Скопировать
            </Button>
          </p>
        </div>
      )}

      <details>
        <summary className="cursor-pointer font-semibold">
          Загрузить колонку анкеты
        </summary>
        <form
          className="mt-3 grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            const list = form.get("respondentList");
            // Колонка вставляется как есть: пробелы строк разбирает сервер.
            props.onImport(typeof list === "string" ? list : "");
          })}
        >
          <AdminTextArea
            hint="Вставьте колонку целиком. @nick, nick и ссылки t.me распознаются, повторы схлопываются, email и телефоны считаются нераспознанными. Повторная загрузка только добавляет новые ники."
            label="Колонка с Telegram"
            name="respondentList"
            required
            rows={8}
          />
          <p>
            <Button disabled={props.busy} type="submit" variant="outline">
              Загрузить
            </Button>
          </p>
        </form>
        {props.imported === null ? null : (
          <p className="mt-3 text-sm" role="status">
            Распознано {props.imported.recognized}, новых {props.imported.added}
            , не распознано {props.imported.unrecognized}. Всего в списке{" "}
            {props.imported.total}.
          </p>
        )}
      </details>

      {props.data === null || props.data.respondents.length === 0 ? null : (
        <details>
          <summary className="cursor-pointer font-semibold">
            Весь список
          </summary>
          <ul className="mt-3 grid gap-1 text-sm">
            {props.data.respondents.map((row) => (
              <li
                className="flex min-w-0 flex-wrap justify-between gap-x-4"
                key={row.username}
              >
                <span className="break-all font-mono">@{row.username}</span>
                <span className="text-muted-foreground">
                  {row.purchased
                    ? "купил"
                    : row.issuedAt === null
                      ? "ссылки нет"
                      : `ссылка выдана ${issuedDate.format(new Date(row.issuedAt))}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </AdminSection>
  );
}
