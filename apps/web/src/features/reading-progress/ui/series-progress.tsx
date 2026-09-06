import { CircleCheck } from "lucide-react";
import type { SeriesProgressView } from "../model/reading-progress-view";

export function SeriesProgress({ view }: { readonly view: SeriesProgressView }) {
  return (
    <div aria-live="polite" className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-series-progress>
      {view.kind === "loading" ? <span className="text-muted-foreground">Загружаем прогресс…</span> :
        view.kind === "unavailable" ? <span className="text-muted-foreground">Прогресс пока недоступен</span> : <>
          <span className="tabular-nums text-muted-foreground">Изучено {view.read} из {view.total}</span>
          {view.total > 0 && view.read === view.total ? <span className="inline-flex items-center gap-1.5 font-medium"><CircleCheck aria-hidden="true" className="size-4" />Все материалы изучены</span> : null}
        </>}
    </div>
  );
}
