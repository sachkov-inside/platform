import type { MaterialLabeledRow } from "@inside/material-blocks";

/** Список терминов: метка слева, название и пояснение рядом. */
export function MaterialLabeledList({
  rows,
}: {
  readonly rows: readonly MaterialLabeledRow[];
}) {
  return (
    <dl
      className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border"
      data-material-block="labeledList"
    >
      {rows.map((row, index) => (
        <div
          className="grid gap-x-4 gap-y-1 bg-card px-5 py-4 sm:grid-cols-[minmax(6rem,10rem)_1fr] sm:px-6"
          key={index}
        >
          <dt className="flex items-start">
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-[0.6875rem] text-muted-foreground">
              {row.label}
            </span>
          </dt>
          <dd className="m-0 min-w-0">
            <span className="break-words font-semibold text-foreground">{row.name}</span>
            {row.description === undefined ? null : (
              <span className="mt-1 block text-[0.9375rem] leading-7 text-body-muted">
                {row.description}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
