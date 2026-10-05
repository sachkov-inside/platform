/** Список тем или продуктов не прочитан: страница называет код обращения и просит обновить. */
export function ContentCollectionsUnavailable({
  reference,
}: {
  readonly reference: string;
}) {
  return (
    <main
      className="grid min-h-svh place-items-center px-5"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="max-w-lg rounded-2xl bg-card p-7 text-center shadow-card">
        <h1 className="text-2xl font-semibold">
          Структура временно недоступна
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Обновите страницу. Код: {reference}
        </p>
      </div>
    </main>
  );
}
