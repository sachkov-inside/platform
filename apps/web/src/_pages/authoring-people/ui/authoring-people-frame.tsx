import type { ReactNode } from "react";

/**
 * Каркас списка людей: `main` маршрута, который оболочка админки прокручивает, и отступы. Готовый
 * список, его скелет и ошибки стоят в одном каркасе, поэтому приход данных не сдвигает отступы.
 */
export function AuthoringPeopleFrame({
  busy = false,
  children,
  label,
  labelledBy,
}: {
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly label?: string;
  readonly labelledBy?: string;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      className="authoring-page"
      data-authoring-people-frame
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        {children}
      </div>
    </main>
  );
}

/** Продукт, способ получения и состояние доступа: столько выборов в строке фильтров и скелете. */
export const peopleFilterCount = 3;
/** «Человек», «Продукты», «Регистрация», «Последняя активность» и «⋯». */
export const peopleTableColumnCount = 5;
