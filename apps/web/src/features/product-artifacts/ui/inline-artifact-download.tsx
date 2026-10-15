import { Download, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { formatArtifactSize } from "../model/product-artifacts";
import type { ReaderProductArtifact } from "../model/reader-product-artifacts";

/** A file action stays distinct from the ordinary link that opens the reading page. */
export function InlineArtifactDownload({
  href,
  label,
  artifact,
  loading = false,
}: {
  readonly href: string;
  readonly label: ReactNode;
  readonly artifact?: ReaderProductArtifact | undefined;
  readonly loading?: boolean;
}) {
  const file = artifact?.content.kind === "file" ? artifact.content : undefined;
  const available =
    artifact?.availability === "available" && file !== undefined;
  return (
    <span
      className="my-2 inline-grid max-w-full gap-2 align-middle"
      data-inline-artifact
    >
      {available ? (
        <a
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-base font-semibold text-primary-foreground no-underline hover:bg-primary/90"
          download
          href={href}
        >
          <Download aria-hidden="true" className="size-4 shrink-0" />
          {label}
        </a>
      ) : (
        <span
          aria-busy={loading || undefined}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-muted px-4 py-2 text-base font-medium text-muted-foreground"
        >
          {artifact?.availability === "locked" ? (
            <Lock aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <Download aria-hidden="true" className="size-4 shrink-0" />
          )}
          {label}
        </span>
      )}
      <span className="break-words text-sm leading-5 text-muted-foreground">
        {loading
          ? "Загружаем файл…"
          : file !== undefined && available
            ? `${file.filename} · ${formatArtifactSize(file.size)}`
            : artifact?.availability === "locked"
              ? "Файл откроется с доступом к продукту"
              : "Файл сейчас недоступен"}
      </span>
    </span>
  );
}
