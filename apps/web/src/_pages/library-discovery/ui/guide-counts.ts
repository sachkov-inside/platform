/**
 * Счётные подписи руководства для страницы продукта и программы. Обе страницы называют одно и то
 * же — главы и артефакты, — поэтому склонение живёт здесь, а не повторяется в каждой.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const tail = count % 100;
  const last = count % 10;
  const noun = tail > 10 && tail < 20 ? many : last === 1 ? one : last > 1 && last < 5 ? few : many;
  return `${String(count)} ${noun}`;
}

export function formatChapterCount(count: number): string {
  return plural(count, "глава", "главы", "глав");
}

export function formatArtifactCount(count: number): string {
  return plural(count, "артефакт", "артефакта", "артефактов");
}
