import type { ReactNode } from "react";

/**
 * Рамка страницы редактора руководства: прокручиваемое содержимое маршрута и его ширина.
 */
export function ProductEditorPageFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <main className="authoring-page" id="authoring-content" tabIndex={-1}>
      <div className="authoring-page-body">{children}</div>
    </main>
  );
}
