import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui/button";

import type { MaterialPreviewPresentation } from "../model/presentation";
import { MaterialAuthoringShell } from "./material-authoring-shell";
import { MaterialPreview } from "./material-preview";

interface MaterialCurrentPreviewProps {
  readonly editorHref: string;
  readonly preview: MaterialPreviewPresentation;
}

/** Server-renderable shell for the current saved Material preview. */
export function MaterialCurrentPreview({
  editorHref,
  preview,
}: MaterialCurrentPreviewProps) {
  return (
    <MaterialAuthoringShell current="preview">
      <main
        aria-labelledby="exact-preview-heading"
        className="h-full min-h-svh overflow-y-auto bg-background text-foreground md:min-h-0"
        data-exact-preview
        id="authoring-content"
        tabIndex={-1}
      >
        <header className="sticky top-0 z-30 border-b border-border bg-card px-4 py-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-[80rem] flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild className="size-11" size="icon-lg" variant="ghost">
                <Link href={{ pathname: editorHref }}>
                  <ArrowLeft aria-hidden="true" />
                  <span className="sr-only">Вернуться в редактор</span>
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold" id="exact-preview-heading">
                  Preview текущей версии
                </h1>
                <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                  v{preview.contentVersion} · {publicationStateLabel(preview.publicationState)}
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href={{ pathname: editorHref }}>Вернуться в редактор</Link>
            </Button>
          </div>
        </header>
        <div
          className="border-b border-border bg-card px-4 py-2.5 text-center text-xs text-muted-foreground"
          data-preview-version-banner
        >
          {previewBanner(preview)}
        </div>
        <MaterialPreview preview={preview} />
      </main>
    </MaterialAuthoringShell>
  );
}

function publicationStateLabel(
  state: MaterialPreviewPresentation["publicationState"],
): string {
  switch (state) {
    case "draft":
      return "черновик";
    case "published":
      return "опубликовано";
    case "unpublished":
      return "снято с публикации";
  }
}

function previewBanner(preview: MaterialPreviewPresentation): string {
  switch (preview.publicationState) {
    case "draft":
      return `Это сохранённый черновик v${String(preview.contentVersion)}. Материал ещё не опубликован.`;
    case "published":
      return `Это текущая live-версия v${String(preview.contentVersion)}.`;
    case "unpublished":
      return `Это сохранённая версия v${String(preview.contentVersion)}. Материал снят с публикации.`;
  }
}
