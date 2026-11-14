"use client";

import { useSyncExternalStore } from "react";

import { formatRoadmapUpdatedOn } from "./course-roadmap";

const subscribe = () => () => undefined;
const readYear = () => new Date().getFullYear();
// The server never reads the clock while rendering (Cache Components): its line keeps the year.
const readServerYear = () => null;

/** «Обновлено 13 ноября»: год виден, только если обновление было не в этом году. */
export function RoadmapUpdatedOn({ date }: { readonly date: string }) {
  const year = useSyncExternalStore(subscribe, readYear, readServerYear);
  return (
    <p className="text-xs text-muted-foreground" data-roadmap-updated={date}>
      Обновлено{" "}
      <time dateTime={date}>{formatRoadmapUpdatedOn(date, year)}</time>
    </p>
  );
}
