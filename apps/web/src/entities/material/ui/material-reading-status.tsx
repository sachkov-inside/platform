import { CircleCheck } from "lucide-react";

export function materialReadingLabels(format: string) {
  switch (format.toLowerCase()) {
    case "note": case "заметка": case "text": case "текст": case "статья":
      return { action: "Отметить прочитанным", complete: "Прочитано" };
    case "video": case "видео":
      return { action: "Отметить просмотренным", complete: "Просмотрено" };
    default:
      return { action: "Отметить изученным", complete: "Изучено" };
  }
}

/** One personal status label for Reader and every Material card variant. */
export function MaterialReadingStatus({ format, isRead }: { readonly format: string; readonly isRead: boolean }) {
  if (!isRead) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground" data-material-reading-status>
      <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
      {materialReadingLabels(format).complete}
    </span>
  );
}
