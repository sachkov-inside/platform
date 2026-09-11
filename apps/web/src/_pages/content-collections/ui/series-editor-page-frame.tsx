import type { ReactNode } from "react";

/**
 * Рамка страницы редактора руководства: прокручиваемое содержимое маршрута и его ширина.
 * Приложение и Storybook берут её отсюда, поэтому разделы редактора видны в одном кадре.
 */
export function SeriesEditorPageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <main
      className="h-full min-h-svh overflow-y-auto bg-background text-foreground md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-8">{children}</div>
    </main>
  );
}
