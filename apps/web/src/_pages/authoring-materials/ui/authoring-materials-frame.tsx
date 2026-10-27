import type { ReactNode } from "react";

/**
 * Каркас страницы «Материалы»: `main` маршрута, который оболочка админки делает областью прокрутки,
 * и отступы содержимого. Готовый список, его скелет и состояния ошибки стоят в одном каркасе, поэтому
 * приход данных не меняет ни отступов, ни того, что прокручивается.
 */
export function AuthoringMaterialsFrame({
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
      data-authoring-materials-frame
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        {children}
      </div>
    </main>
  );
}
