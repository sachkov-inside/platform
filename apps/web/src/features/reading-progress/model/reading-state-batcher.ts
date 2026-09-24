import type { z } from "zod";

import type { ReadingState, readingStatesResultSchema } from "./reading-contract";

type ReadingStatesResult = z.infer<typeof readingStatesResultSchema>;

interface Waiter {
  readonly resolve: (state: ReadingState) => void;
  readonly reject: (error: Error) => void;
}

/** Предел одного запроса задаёт контракт BFF. */
const MAX_BATCH_SIZE = 100;

/**
 * Прогресс хранится в кеше по ключу материала, а читается пакетом: идентификаторы, запрошенные в
 * одном такте, уходят одним запросом. Раньше ключом был сам набор карточек, поэтому новый набор
 * перечитывал и то, что уже известно (ADR 0027).
 */
export function createReadingStateBatcher(
  loadStates: (materialIds: readonly string[]) => Promise<ReadingStatesResult>,
): (materialId: string) => Promise<ReadingState> {
  let waiting = new Map<string, Waiter[]>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const current = waiting;
    waiting = new Map();
    const ids = [...current.keys()].sort();
    for (let offset = 0; offset < ids.length; offset += MAX_BATCH_SIZE) {
      void settle(ids.slice(offset, offset + MAX_BATCH_SIZE), current);
    }
  };

  const settle = async (batch: readonly string[], current: ReadonlyMap<string, Waiter[]>) => {
    const fail = (error: Error) => {
      for (const id of batch) for (const waiter of current.get(id) ?? []) waiter.reject(error);
    };
    let result: ReadingStatesResult;
    try {
      result = await loadStates(batch);
    } catch (error) {
      fail(error instanceof Error ? error : new Error("unavailable"));
      return;
    }
    if (result.kind !== "ready") {
      fail(new Error(result.kind));
      return;
    }
    const states = new Map(result.states.map((state) => [state.materialId, state]));
    // Ответ обязан описать ровно запрошенные материалы: лишний, повторный или пропущенный — сбой контракта.
    if (result.states.length !== batch.length || states.size !== batch.length || batch.some((id) => !states.has(id))) {
      fail(new Error("invalid_response"));
      return;
    }
    for (const id of batch) {
      const state = states.get(id);
      if (state !== undefined) for (const waiter of current.get(id) ?? []) waiter.resolve(state);
    }
  };

  return (materialId) =>
    new Promise<ReadingState>((resolve, reject) => {
      const waiters = waiting.get(materialId) ?? [];
      waiters.push({ reject, resolve });
      waiting.set(materialId, waiters);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    });
}
