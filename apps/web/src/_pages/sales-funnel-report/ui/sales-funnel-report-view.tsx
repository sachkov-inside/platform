import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import {
  funnelSteps,
  type SalesFunnelReportView as ReportView,
  type SurveyRespondentsView,
} from "../model/sales-funnel-report";

const fieldClass =
  "min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";
const cardClass =
  "min-w-0 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6";

/**
 * Temporary semantic UI for #816.
 * Replace through #819 after Storybook acceptance.
 */
export function SalesFunnelReportView({ view }: { readonly view: ReportView }) {
  const product = view.products.find((item) => item.id === view.productId);
  return (
    <SalesFunnelReportFrame>
      <header className="grid gap-2">
        <h1 className="text-balance text-3xl font-bold tracking-[-0.04em]">
          Воронка продаж
        </h1>
        <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
          Сколько людей дошло до каждого шага: от входа в бот до оплаты
          продукта. Только общие числа по источникам, без отдельных людей.
        </p>
      </header>

      <form
        action="/authoring/sales-funnel"
        aria-label="Выбор отчёта"
        className={`${cardClass} grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_repeat(2,minmax(0,0.8fr))_auto] lg:items-end`}
        method="get"
      >
        <Field label="Продукт">
          <select
            className={fieldClass}
            defaultValue={view.productId ?? ""}
            name="productId"
          >
            {view.products.length === 0 ? (
              <option value="">Продуктов нет</option>
            ) : null}
            {view.products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Глава">
          <select
            className={fieldClass}
            defaultValue={view.chapterId ?? ""}
            disabled={product === undefined || product.chapters.length === 0}
            name="chapterId"
          >
            {product === undefined || product.chapters.length === 0 ? (
              <option value="">Глав нет</option>
            ) : null}
            {product?.chapters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="С">
          <input
            className={fieldClass}
            defaultValue={view.from}
            name="from"
            required
            type="date"
          />
        </Field>
        <Field label="По">
          <input
            className={fieldClass}
            defaultValue={view.to}
            name="to"
            required
            type="date"
          />
        </Field>
        <Button
          className="min-h-11 px-5 sm:col-span-2 lg:col-span-1"
          type="submit"
        >
          Показать
        </Button>
      </form>

      {view.notice === null ? null : (
        <p
          className="rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm"
          role="status"
        >
          {view.notice}
        </p>
      )}
      {view.lastBotEventAt === null ? (
        <p
          className="rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6"
          data-bot-events="none"
        >
          Бот ещё не передавал события. Шаги «Вход в бот» и «Согласие на
          рассылку» появятся, когда он начнёт их отправлять
          (inside-telegram#118); до этого люди из бота видны как «Не через
          бота».
        </p>
      ) : null}

      <section aria-labelledby="sales-funnel-table-title" className={cardClass}>
        <h2
          className="text-xl font-semibold tracking-[-0.02em]"
          id="sales-funnel-table-title"
        >
          {product === undefined ? "Шаги бота" : product.name}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {formatPeriod(view.from, view.to)}, по московскому времени
          {view.chapterName === null ? "" : `. Глава: ${view.chapterName}`}
        </p>
        {view.rows.length === 0 ? (
          <p className="mt-5 text-sm leading-6" data-report-empty>
            За этот период никто не дошёл ни до одного шага.
          </p>
        ) : (
          <div
            aria-label="Таблица воронки по источникам"
            className="mt-5 overflow-x-auto"
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left align-bottom">
                  <th className="py-2 pr-4 font-medium" scope="col">
                    Источник
                  </th>
                  {funnelSteps.map((step) => (
                    <th
                      className="px-3 py-2 text-right font-medium"
                      key={step.key}
                      scope="col"
                    >
                      <span className="block">{step.label}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {step.unit}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr className="border-b border-border/60" key={row.key}>
                    <th
                      className="py-2.5 pr-4 text-left font-medium"
                      scope="row"
                    >
                      {row.label}
                    </th>
                    {row.counts.map((count) => (
                      <Count key={count.step} value={count.value} />
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <th className="py-2.5 pr-4 text-left" scope="row">
                    Всего
                  </th>
                  {view.total.map((count) => (
                    <Count key={count.step} value={count.value} />
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <SurveyRespondents respondents={view.surveyRespondents} />

      <section aria-labelledby="sales-funnel-rules" className={cardClass}>
        <h2 className="text-base font-semibold" id="sales-funnel-rules">
          Как считаются числа
        </h2>
        <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            Воронка идёт за когортой: это люди, которые впервые вошли в бот в
            выбранный период. Каждый следующий шаг показывает, сколько из них
            дошло до него к сегодняшнему дню.
          </li>
          <li>
            Источник — метка ссылки, по которой человек впервые вошёл в бот.
            Аккаунт получает источник своего контакта в боте и сохраняет его
            после отвязки Telegram. Аккаунт без известного входа в бот — «Не
            через бота»: он попадает в когорту, если его первый шаг по продукту
            пришёлся на период.
          </li>
          <li>
            «Открыл главу» — вошедший читатель открыл любой урок выбранной
            главы. «Перешёл к оплате» — открыл оплату предложения этого
            продукта. «Оплатил» — оплата подтверждена банком; возвраты не
            вычитаются.
          </li>
          <li>«—» — шаг к этой строке не относится или ещё не измеряется.</li>
          <li>
            Респонденты анкеты считаются по личным ссылкам со скидкой: ник из
            анкеты не связан с аккаунтом. «Купили» — оплата этого продукта по
            личной ссылке подтверждена банком в выбранный период; загруженные
            ники и выданные ссылки — все на сегодня. Метка «survey» в таблице —
            вход в бот по ссылке анкеты, а не число респондентов.
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Отчёт собран {view.generatedAt}.
          {view.lastBotEventAt === null
            ? ""
            : ` Последнее событие бота получено ${view.lastBotEventAt}.`}
        </p>
      </section>
    </SalesFunnelReportFrame>
  );
}

function SurveyRespondents({
  respondents,
}: {
  readonly respondents: SurveyRespondentsView | null;
}) {
  return (
    <section
      aria-labelledby="sales-funnel-survey-title"
      className={cardClass}
      data-survey-respondents
    >
      <h2
        className="text-xl font-semibold tracking-[-0.02em]"
        id="sales-funnel-survey-title"
      >
        Респонденты анкеты
      </h2>
      {respondents === null ? (
        <p className="mt-2 text-sm leading-6" data-survey-respondents-missing>
          Показатель недоступен: список ников анкеты ещё не загружен в разделе
          «Оплата и права».
        </p>
      ) : (
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          <Figure label="Загружено ников" value={respondents.uploaded} />
          <Figure label="Выдано личных ссылок" value={respondents.issued} />
          <Figure label="Купили по ссылке" value={respondents.paid} />
          <div className="grid gap-1">
            <dt className="text-sm text-muted-foreground">Доля купивших</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {respondents.share?.percent ?? <Unmeasured />}
            </dd>
            {respondents.share === null ? null : (
              <dd className="text-xs text-muted-foreground">
                {respondents.share.basis} получивших ссылку
              </dd>
            )}
          </div>
        </dl>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number | null;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">
        {value === null ? <Unmeasured /> : value.toLocaleString("ru-RU")}
      </dd>
    </div>
  );
}

export function SalesFunnelReportFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <main
      aria-label="Воронка продаж"
      className="flex h-full min-h-svh flex-col overflow-y-auto bg-background text-foreground md:min-h-0 md:overscroll-y-contain"
      data-sales-funnel-report
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto grid w-full max-w-[76rem] content-start gap-6 px-4 py-7 pb-16 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
        {children}
      </div>
    </main>
  );
}

function Field({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Count({ value }: { readonly value: number | null }) {
  return (
    <td className="px-3 py-2.5 text-right tabular-nums">
      {value === null ? <Unmeasured /> : value.toLocaleString("ru-RU")}
    </td>
  );
}

const dayFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatPeriod(from: string, to: string) {
  const format = (date: string) =>
    dayFormat.format(new Date(`${date}T00:00:00Z`));
  return from === to ? format(from) : `${format(from)} — ${format(to)}`;
}

function Unmeasured() {
  return (
    <span aria-label="не измеряется" className="text-muted-foreground">
      —
    </span>
  );
}
