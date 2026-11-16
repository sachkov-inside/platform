import { PreviewNotice } from "./file-preview-notice";
import type { PreviewIndex } from "./file-preview-page";

type PreviewEntry = PreviewIndex["materials"][number];

/** The package contents: every lesson and Task page the preview can open. */
export function FilePreviewIndex({
  index,
  missing,
}: {
  readonly index: PreviewIndex;
  readonly missing: boolean;
}) {
  return (
    <PreviewNotice
      title={missing ? "Такой страницы в пакете нет" : "Предпросмотр пакета"}
    >
      <p className="mt-3 text-body-muted">
        {index.products.length === 0
          ? "Страницы пакета открываются так, как их покажет сайт."
          : `Курс: ${index.products.map((product) => product.title).join(", ")}.`}
      </p>
      <PreviewList title="Уроки" entries={index.materials} />
      <PreviewList title="Задания" entries={index.tasks} />
    </PreviewNotice>
  );
}

function PreviewList({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly PreviewEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-[-0.015em]">{title}</h2>
      <ul className="mt-3 grid gap-2">
        {entries.map((entry) => (
          <li key={entry.sourceId}>
            <a className="underline underline-offset-4" href={entry.href}>
              {entry.title}
            </a>{" "}
            <span className="text-sm text-muted-foreground">
              {entry.sourceId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
