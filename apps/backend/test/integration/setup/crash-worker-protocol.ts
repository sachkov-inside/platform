/**
 * Что аварийный воркер сообщает тесту. Два имени живут здесь, а не по копии в каждом файле:
 * разошедшиеся литералы превратились бы в ожидание сообщения, которого никто не отправляет.
 */
export const crashWorkerSignals = {
  /** Воркер поднялся и подключился к брокеру. Дальше начинается проверяемое поведение. */
  ready: "ready",
  /** Воркер дошёл до границы своей фазы и ждёт, когда его убьют. */
  boundary: "boundary",
} as const;

export type CrashWorkerSignal =
  (typeof crashWorkerSignals)[keyof typeof crashWorkerSignals];
