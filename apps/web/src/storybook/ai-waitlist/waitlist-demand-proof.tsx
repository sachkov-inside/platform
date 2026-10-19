import { useState } from "react";
import { Button } from "@/shared/ui/button";

export type DemandState = "ready" | "empty" | "unavailable";
const sampleSources = [
  { source: "channel", active: 75, joined: 22, left: 2 },
  { source: "youtube", active: 32, joined: 8, left: 1 },
  { source: "survey", active: 15, joined: 5, left: 1 },
  { source: "Неизвестен", active: 6, joined: 2, left: 0 },
];
const sampleWeeks = [
  { period: "1–7 марта", joined: 12, left: 0 },
  { period: "8–14 марта", joined: 8, left: 2 },
  { period: "15–21 марта", joined: 10, left: 1 },
  { period: "22–31 марта", joined: 7, left: 1 },
];

// Presentation fixtures only. Totals demonstrate the distinction between stock and period changes.
export function WaitlistDemandProof({
  state,
}: {
  readonly state: DemandState;
}) {
  const [retrying, setRetrying] = useState(false);
  const empty = state === "empty";
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
            AI Engineering · Следующий набор
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          Пример данных для макета
        </span>
      </div>
      {state === "unavailable" ? (
        <div className="mt-5 grid justify-items-start gap-3">
          <p role="alert">
            Данные ожидания недоступны. Число записавшихся пока неизвестно.
          </p>
          <Button
            onClick={() => {
              setRetrying(true);
            }}
            variant="outline"
          >
            Повторить загрузку
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {retrying
              ? "В примере источник остаётся недоступным. Это не ноль записей."
              : ""}
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid gap-5 sm:grid-cols-3">
            {[
              {
                label: "В списке сейчас",
                value: empty ? 0 : 128,
                note: "Уникальные активные записи на набор",
              },
              {
                label: "Записались за период",
                value: empty ? 0 : 37,
                note: "1–31 марта 2030",
              },
              {
                label: "Отказались за период",
                value: empty ? 0 : 4,
                note: "1–31 марта 2030",
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
                      {sampleSources.map((row) => (
                        <tr
                          key={row.source}
                          className="border-b border-border/60"
                        >
                          <th
                            scope="row"
                            className="py-3 pr-4 text-left font-medium"
                          >
                            {row.source}
                          </th>
                          <td className="p-2 text-right tabular-nums">
                            {row.active}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {row.joined}
                          </td>
                          <td className="py-2 pl-2 text-right tabular-nums">
                            {row.left}
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
                    {sampleWeeks.map((row) => (
                      <tr
                        key={row.period}
                        className="border-b border-border/60"
                      >
                        <th
                          scope="row"
                          className="py-3 pr-3 text-left font-medium"
                        >
                          {row.period}
                        </th>
                        <td className="p-2 text-right tabular-nums">
                          {row.joined}
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums">
                          {row.left}
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
            отдельной главе. «В списке сейчас» — активные аккаунты; записи и
            отказы — изменения за выбранный период. Повторная запись не
            добавляет ещё одного человека. Источник без сохранённой метки
            показан отдельно как «Неизвестен».
          </p>
        </>
      )}
    </section>
  );
}
