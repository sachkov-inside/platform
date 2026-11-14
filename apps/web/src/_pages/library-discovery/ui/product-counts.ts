/**
 * Счётные подписи руководства для страницы продукта и программы. Обе страницы называют одно и то
 * же — главы, артефакты и задания, — поэтому склонение живёт здесь, а не повторяется в каждой.
 */
function pluralForm<T>(count: number, one: T, few: T, many: T): T {
  const tail = count % 100;
  const last = count % 10;
  return tail > 10 && tail < 20
    ? many
    : last === 1
      ? one
      : last > 1 && last < 5
        ? few
        : many;
}

function plural(count: number, one: string, few: string, many: string): string {
  return `${String(count)} ${pluralForm(count, one, few, many)}`;
}

export function formatChapterCount(count: number): string {
  return plural(count, "глава", "главы", "глав");
}

export function formatArtifactCount(count: number): string {
  return plural(count, "артефакт", "артефакта", "артефактов");
}

export function formatTaskCount(count: number): string {
  return plural(count, "задание", "задания", "заданий");
}

export function formatStepCount(count: number): string {
  return plural(count, "шаг", "шага", "шагов");
}

/** «Готова 1 глава», «Готовы 2 главы», «Готово 5 глав»: глагол согласуется с числом. */
export function formatDoneChapters(count: number): string {
  return `${pluralForm(count, "Готова", "Готовы", "Готово")} ${formatChapterCount(count)}`;
}

/** Родительный падеж после «из»: «из 1 урока», «из 7 уроков», «из 21 урока». */
export function formatOfLessons(count: number): string {
  return `из ${plural(count, "урока", "уроков", "уроков")}`;
}
