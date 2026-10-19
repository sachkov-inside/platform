import Link from "next/link";
import { Button } from "@/shared/ui/button";
import type { SalesFunnelReport } from "../model/sales-funnel-report";
export function WaitlistDemandView({
  data,
  productName,
  from,
  to,
}: {
  readonly data: SalesFunnelReport["waitlist"];
  readonly productName: string;
  readonly from: string;
  readonly to: string;
}) {
  const empty = data?.active === 0 && data.joined === 0 && data.withdrawn === 0;
  return (
    <section
      aria-labelledby="waitlist-report-title"
      className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="waitlist-report-title"
            className="text-xl font-semibold tracking-[-0.02em]"
          >
            Ожидание набора
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {productName} · {data?.name ?? "Следующий набор"}
          </p>
        </div>
      </div>
      {data === null ? (
        <div className="mt-5 grid justify-items-start gap-3">
          <p role="alert">
            Данные ожидания недоступны. Число записавшихся пока неизвестно.
          </p>
          <Button asChild variant="outline">
            <Link href="/authoring/sales-funnel">Повторить загрузку</Link>
          </Button>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid gap-5 sm:grid-cols-3">
            {[
              {
                label: "В списке сейчас",
                value: data.active,
                note: "Уникальные активные записи на набор",
              },
              {
                label: "Записались за период",
                value: data.joined,
                note: `${from} / ${to}`,
              },
              {
                label: "Отказались за период",
                value: data.withdrawn,
                note: `${from} / ${to}`,
              },
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-sm text-muted-foreground">{item.label}</dt>
                <dd className="mt-1 text-3xl font-semibold tabular-nums">
                  {item.value}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {item.note}
                </dd>
              </div>
            ))}
          </dl>
          {empty ? (
            <p className="mt-6 text-sm">В этом наборе пока нет записей.</p>
          ) : (
            <div className="mt-7 grid min-w-0 gap-7 xl:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-base font-semibold">Источники записи</h3>
                <div
                  aria-label="Источники ожидания"
                  className="mt-3 overflow-x-auto"
                  role="region"
                  tabIndex={0}
                >
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Источник
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2 text-right font-medium"
                        >
                          В списке
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2 text-right font-medium"
                        >
                          Записи
                        </th>
                        <th
                          scope="col"
                          className="py-2 pl-2 text-right font-medium"
                        >
                          Отказы
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.map((row) => (
                        <tr
                          key={row.source ?? "unknown"}
                          className="border-b border-border/60"
                        >
                          <th
                            scope="row"
                            className="py-3 pr-4 text-left font-medium"
                          >
                            {row.source ?? "Неизвестен"}
                          </th>
                          <td className="p-2 text-right tabular-nums">
                            {row.active}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {row.joined}
                          </td>
                          <td className="py-2 pl-2 text-right tabular-nums">
                            {row.withdrawn}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold">Динамика за период</h3>
                <table className="mt-3 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Неделя
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right font-medium"
                      >
                        Записи
                      </th>
                      <th
                        scope="col"
                        className="py-2 pl-2 text-right font-medium"
                      >
                        Отказы
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeks.map((row) => (
                      <tr key={row.from} className="border-b border-border/60">
                        <th
                          scope="row"
                          className="py-3 pr-3 text-left font-medium"
                        >
                          {row.from}
                        </th>
                        <td className="p-2 text-right tabular-nums">
                          {row.joined}
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums">
                          {row.withdrawn}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="mt-5 max-w-[85ch] text-sm leading-6 text-muted-foreground">
            Запись относится к выбранному набору, а не к текущему потоку и не к
            отдельной главе. «В списке сейчас» показывает число активных
            аккаунтов. Записи и отказы показывают изменения за выбранный период.
            Повторная запись не добавляет ещё одного человека. Источник без
            сохранённой метки показан отдельно как «Неизвестен».
          </p>
        </>
      )}
    </section>
  );
}
