import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

/** Итоги урока: названный список, каждый пункт помечен галочкой. */
export function MaterialTakeaways({
  items,
  title,
}: {
  readonly items: readonly ReactNode[];
  readonly title: string;
}) {
  return (
    <section
      aria-label={title.length === 0 ? "Итоги" : title}
      className="mt-8 rounded-xl border border-border bg-secondary/60 px-5 py-5 sm:px-6"
      data-material-block="takeaways"
    >
      <p className="text-base font-semibold text-foreground">{title}</p>
      {items.length === 0 ? null : (
        <ul className="mt-3 grid gap-3 text-[0.9375rem] leading-7" role="list">
          {items.map((item, index) => (
            <li className="flex items-start gap-3" key={index}>
              <CircleCheck
                aria-hidden="true"
                className="mt-1 size-4 shrink-0 text-action"
              />
              <span className="min-w-0 flex-1">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
