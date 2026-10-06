/**
 * Что аварийный воркер сообщает тесту. Имена живут здесь, а не по копии в каждом файле:
 * разошедшиеся литералы превратились бы в ожидание сообщения, которого никто не отправляет.
 */
export const crashWorkerSignals = {
  /** Воркер поднялся и подключился к брокеру. Дальше начинается проверяемое поведение. */
  ready: "ready",
  /** Воркер дошёл до границы своей фазы и ждёт, когда его убьют. */
  boundary: "boundary",
  /** Подтверждение публикации истекло, но воркер всё ещё удерживает границу before-confirm. */
  confirmExpired: "confirm-expired",
} as const;

export type CrashWorkerSignal =
  (typeof crashWorkerSignals)[keyof typeof crashWorkerSignals];
