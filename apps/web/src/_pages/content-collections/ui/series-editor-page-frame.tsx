import type { ReactNode } from "react";

/**
 * Рамка страницы редактора руководства: прокручиваемое содержимое маршрута и его ширина.
 * Приложение и Storybook берут её отсюда, поэтому разделы редактора видны в одном кадре.
 */
export function SeriesEditorPageFrame({
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
