"use client";
import { Button } from "@/shared/ui/button";
import { useHomePin } from "../model/use-home-pin.client";
import type { HomePinControls } from "../model/home-pin";

export function HomeSeriesPin({ seriesId }: { readonly seriesId: string }) {
  const state = useHomePin();
  return <HomeSeriesPinView seriesId={seriesId} controls={state.controls} message={state.message} hasError={state.hasError} onRetry={state.retry} />;
}

export function HomeSeriesPinView({ seriesId, controls, message, hasError = false, onRetry }: {
  readonly seriesId: string;
  readonly controls: HomePinControls;
  readonly message: string;
  readonly hasError?: boolean;
  readonly onRetry?: () => void;
}) {
  const selected = controls.pin?.seriesId === seriesId;
  return <section aria-label="Закреп серии на главной" className="my-5 grid gap-3 border-b border-border pb-5">
    <Button type="button" variant="outline" className="min-h-11 w-full sm:w-fit" disabled={!hasError && (controls.pin === null || controls.pending)} onClick={() => { if (hasError) onRetry?.(); else controls.onChange(selected ? null : seriesId); }}>
      {hasError ? "Обновить закреп" : selected ? "Снять закреп с главной" : "Закрепить на главной"}
    </Button>
    <p role={hasError ? "alert" : "status"} className="min-h-20 text-sm sm:min-h-12 text-muted-foreground">{message}</p>
  </section>;
}
