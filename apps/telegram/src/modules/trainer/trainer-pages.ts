import { TRAINER_TOPICS_PAGE_SIZE } from "./widget/trainer-widget-limits.js";

/** A bounded page of topics. Old links remain usable after an import removes topics. */
export function trainerTopicsPage<T>(items: readonly T[], requested = 0) {
  const pages = Math.max(1, Math.ceil(items.length / TRAINER_TOPICS_PAGE_SIZE));
  const page = Math.min(Math.max(0, Math.trunc(requested)), pages - 1);
  return {
    rows: items.slice(
      page * TRAINER_TOPICS_PAGE_SIZE,
      (page + 1) * TRAINER_TOPICS_PAGE_SIZE,
    ),
    page,
    pages,
  };
}
