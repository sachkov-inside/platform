import { CircleCheck } from "lucide-react";
import type { SeriesProgressView } from "../model/reading-progress-view";

export function SeriesProgress({ view }: { readonly view: SeriesProgressView }) {
  const complete = view.kind === "ready" && view.total > 0 && view.read === view.total;
  return (
    <div aria-live="polite" className="min-w-0 space-y-3" data-series-progress>
      {view.kind === "loading" ? <p className="text-muted-foreground">Загружаем прогресс…</p> :
        view.kind === "unavailable" ? <p className="text-muted-foreground">Прогресс пока недоступен</p> : <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 tabular-nums">
            <p className="text-lg font-semibold">Изучено {view.read} из {view.total}</p>
            <span className="text-sm text-muted-foreground">{view.total === 0 ? 0 : Math.round(view.read / view.total * 100)}%</span>
          </div>
          {view.total > 0 ? <progress aria-label="Прогресс руководства" className="block h-2 w-full overflow-hidden rounded-full border-0 bg-border text-accent accent-accent [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent" max={view.total} value={view.read} /> : null}
          {complete ? <p className="inline-flex items-center gap-2 text-sm font-medium"><CircleCheck aria-hidden="true" className="size-4" />Все материалы изучены</p> : null}
        </>}
    </div>
  );
}
