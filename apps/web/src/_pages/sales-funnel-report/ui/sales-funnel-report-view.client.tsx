"use client";

import { formatCount } from "@/shared/lib/moscow-format";
import {
  AdminEmptyState,
  AdminListHeader,
  AdminTable,
  type AdminTableColumn,
} from "@/shared/ui/admin";

import {
  funnelSteps,
  type SalesFunnelReportView as ReportView,
  type StepCount,
  type SurveyRespondentsView,
} from "../model/sales-funnel-report";
import {
  funnelPeriodLabel,
  SalesFunnelFilters,
} from "./sales-funnel-filters.client";
import { SalesFunnelReportFrame } from "./sales-funnel-report-frame";
import { WaitlistDemandView } from "./waitlist-demand-view";

const headingId = "sales-funnel-heading";
const noticeClass =
  "rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6";
const sectionClass = "admin-section grid gap-4";

interface FunnelRow {
  readonly key: string;
  readonly label: string;
  readonly counts: readonly StepCount[];
  readonly total: boolean;
}

function Count({ value }: { readonly value: number | null }) {
  if (value === null)
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">–</span>
        <span className="sr-only">не измеряется</span>
      </span>
    );
  return <span className="tabular-nums">{formatCount(value)}</span>;
}

function countOf(row: FunnelRow, step: StepCount["step"]): number | null {
  return row.counts.find((count) => count.step === step)?.value ?? null;
}

const columns: readonly AdminTableColumn<FunnelRow>[] = [
  { id: "source", header: "Источник", cell: () => null },
  ...funnelSteps.map((step): AdminTableColumn<FunnelRow> => ({
    id: step.key,
    header: step.label,
    align: "end",
    width: "9rem",
    cell: (row) => <Count value={countOf(row, step.key)} />,
  })),
];

function mobileCaption(row: FunnelRow): string {
  return funnelSteps
    .slice(0, -1)
    .map((step) => {
      const value = countOf(row, step.key);
      return `${step.label}: ${value === null ? "не измеряется" : formatCount(value)}`;
    })
    .join(" · ");
}

/**
 * Воронка продаж продукта по источникам бота в общем образце списков: заголовок, фильтры в
 * адресе и таблица источников. Согласие на рассылку не шаг воронки, а отдельная историческая
 * метрика, и появляется только когда бот её прислал.
 */
export function SalesFunnelReportView({ view }: { readonly view: ReportView }) {
  const product = view.products.find((item) => item.id === view.productId);
  const rows: FunnelRow[] = [
    ...view.rows.map((row) => ({ ...row, total: false })),
    ...(view.rows.length === 0
      ? []
      : [{ key: "total", label: "Всего", counts: view.total, total: true }]),
  ];
  return (
    <SalesFunnelReportFrame labelledBy={headingId}>
      <AdminListHeader
        count={funnelPeriodLabel(view)}
        headingId={headingId}
        title="Воронка продаж"
      />
      <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
        Сколько людей дошло до каждого шага: от входа в бот до оплаты продукта.
        Только общие числа по источникам, без отдельных людей.
      </p>
      <SalesFunnelFilters
        key={`${view.productId ?? ""}:${view.chapterId ?? ""}:${view.from}:${view.to}:${String(view.preset)}`}
        view={view}
      />
      {view.notice === null ? null : (
        <p className={noticeClass} role="status">
          {view.notice}
        </p>
      )}
      {view.lastBotEventAt === null ? (
        <p className={noticeClass} data-bot-events="none">
          Бот ещё не передавал события. Шаг «Вход в бот» появится, когда он
          начнёт их отправлять (inside-telegram#118). До этого люди из бота
          видны как «Не через бота».
        </p>
      ) : null}

      <section
        aria-labelledby="sales-funnel-table-title"
        className="grid gap-3"
      >
        <div>
          <h2
            className="text-lg font-semibold tracking-[-0.02em]"
            id="sales-funnel-table-title"
          >
            {product === undefined ? "Шаги бота" : product.name}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            По московскому времени
            {view.chapterName === null ? "" : `. Глава: ${view.chapterName}`}
          </p>
        </div>
        {rows.length === 0 ? (
          <div data-report-empty>
            <AdminEmptyState
              description="Выберите другой период или продукт: за этот период никто не дошёл ни до одного шага."
              title="За этот период шагов нет"
            />
          </div>
        ) : (
          <AdminTable
            caption="Воронка по источникам"
            columns={columns}
            mobileItem={(row) => ({
              title: row.label,
              caption: mobileCaption(row),
              metric: (
                <>
                  <Count value={countOf(row, "paid")} /> оплат
                </>
              ),
            })}
            rowKey={(row) => row.key}
            rowTitle={(row) => row.label}
            rows={rows}
          />
        )}
      </section>

      {view.historicalConsent === null ? null : (
        <section
          aria-labelledby="sales-funnel-consent-title"
          className={sectionClass}
          data-historical-consent
        >
          <div>
            <h2
              className="text-lg font-semibold tracking-[-0.02em]"
              id="sales-funnel-consent-title"
            >
              Историческая метрика согласия
            </h2>
            <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
              Согласие на рассылку больше не обязательный шаг перед покупкой,
              поэтому в воронку оно не входит. Число оставлено для сравнения с
              прежними отчётами.
            </p>
          </div>
          <dl className="grid gap-1">
            <dt className="text-sm text-muted-foreground">
              Согласились на рассылку, контакты бота
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {formatCount(view.historicalConsent)}
            </dd>
          </dl>
        </section>
      )}

      {view.waitlist === null ? (
        <p className="text-sm text-muted-foreground">
          Для этого продукта нет списка ожидания набора.
        </p>
      ) : (
        <WaitlistDemandView
          data={view.waitlist}
          from={view.from}
          productName={product?.name ?? "Продукт"}
          to={view.to}
        />
      )}

      <SurveyRespondents respondents={view.surveyRespondents} />

      <details className="authoring-disclosure">
        <summary>Как считаются числа</summary>
        <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            Воронка идёт за когортой: это люди, которые впервые вошли в бот в
            выбранный период. Каждый следующий шаг показывает, сколько из них
            дошло до него к сегодняшнему дню.
          </li>
          <li>
            Источник: метка ссылки, по которой человек впервые вошёл в бот.
            Аккаунт получает источник своего контакта в боте и сохраняет его
            после отвязки Telegram. Аккаунт без известного входа в бот считается
            «Не через бота»: он попадает в когорту, если его первый шаг по
            продукту пришёлся на период.
          </li>
          <li>
            «Открыл главу»: вошедший читатель открыл любой урок выбранной главы.
            «Перешёл к оплате»: открыл оплату этого продукта. «Оплатил»: оплата
            подтверждена банком, возвраты не вычитаются.
          </li>
          <li>
            Прочерк значит, что шаг к этой строке не относится или ещё не
            измеряется.
          </li>
          <li>
            Респонденты анкеты считаются по личным ссылкам со скидкой: ник из
            анкеты не связан с аккаунтом. «Купили по ссылке»: оплата этого
            продукта по личной ссылке подтверждена банком в выбранный период.
            Загруженные ники и выданные ссылки считаются на сегодня. Метка
            «survey» в таблице означает вход в бот по ссылке анкеты, а не число
            респондентов.
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Отчёт собран {view.generatedAt}.
          {view.lastBotEventAt === null
            ? ""
            : ` Последнее событие бота получено ${view.lastBotEventAt}.`}
        </p>
      </details>
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
      className={sectionClass}
      data-survey-respondents
    >
      <h2
        className="text-lg font-semibold tracking-[-0.02em]"
        id="sales-funnel-survey-title"
      >
        Респонденты анкеты
      </h2>
      {respondents === null ? (
        <p className="text-sm leading-6" data-survey-respondents-missing>
          Показатель недоступен: список ников анкеты ещё не загружен.
        </p>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-4">
          <Figure label="Загружено ников" value={respondents.uploaded} />
          <Figure label="Выдано личных ссылок" value={respondents.issued} />
          <Figure label="Купили по ссылке" value={respondents.paid} />
          <div className="grid gap-1">
            <dt className="text-sm text-muted-foreground">Доля купивших</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {respondents.share?.percent ?? <Count value={null} />}
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
      <dd className="text-2xl font-semibold">
        <Count value={value} />
      </dd>
    </div>
  );
}
