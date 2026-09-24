import "server-only";

/**
 * Одна строка JSON на событие в поток процесса web: журнал контейнера собирает её вместе с остальным
 * выводом, а поле `event` отделяет её от обычного текста Next.js.
 */
export function writeStructuredLog(
  level: "error" | "info",
  event: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  // Служебные поля идут последними: поле события не может их подменить.
  const line = JSON.stringify({ ...fields, time: new Date().toISOString(), level, event });
  if (level === "error") console.error(line);
  else console.info(line);
}
