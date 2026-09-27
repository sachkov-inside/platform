"use client";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
export interface MaterialReadingSnapshot {
  readonly isRead: boolean;
  readonly version: number;
}
export interface MaterialReadingContextValue {
  readonly accountId: string | null;
  readonly resolved: boolean;
  readonly states: ReadonlyMap<string, MaterialReadingSnapshot>;
  readonly failed: boolean;
  readonly register: (materialId: string) => () => void;
  readonly refresh: () => Promise<void>;
}
/**
 * Context несёт не само значение, а хранилище, которое не меняется. Новое значение context над
 * страницей заставляет React нарисовать на клиенте заново часть страницы, пришедшую потоком, но ещё
 * не показанную (#747). Хранилище будит только уже гидрированных читателей.
 */
interface MaterialReadingStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => MaterialReadingContextValue;
  /** Значение, с которым страница нарисована на сервере: по нему гидрируется каждая граница. */
  readonly getServerSnapshot: () => MaterialReadingContextValue;
  readonly publish: (value: MaterialReadingContextValue) => void;
}
function createMaterialReadingStore(
  initial: MaterialReadingContextValue,
): MaterialReadingStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
    getServerSnapshot: () => initial,
    publish: (value) => {
      if (sameReading(current, value)) return;
      current = value;
      for (const listener of listeners) listener();
    },
  };
}
/** Состояния сравниваются по содержанию: провайдер собирает их заново на каждый рендер. */
function sameReading(
  left: MaterialReadingContextValue,
  right: MaterialReadingContextValue,
): boolean {
  return (
    left.accountId === right.accountId &&
    left.resolved === right.resolved &&
    left.failed === right.failed &&
    left.register === right.register &&
    left.refresh === right.refresh &&
    left.states.size === right.states.size &&
    [...left.states].every(([materialId, state]) => {
      const other = right.states.get(materialId);
      return (
        other !== undefined &&
        other.isRead === state.isRead &&
        other.version === state.version
      );
    })
  );
}
const MaterialReadingContext = createContext<MaterialReadingStore>(
  createMaterialReadingStore({
    accountId: null,
    resolved: false,
    states: new Map(),
    failed: false,
    register: () => () => undefined,
    refresh: () => Promise.resolve(),
  }),
);
/** Отдаёт прогресс чтения всему внутри; новое `value` доходит до читателей без смены context. */
export function MaterialReadingScope({
  value,
  children,
}: {
  readonly value: MaterialReadingContextValue;
  readonly children: ReactNode;
}) {
  const [store] = useState(() => createMaterialReadingStore(value));
  useLayoutEffect(() => {
    store.publish(value);
  });
  return (
    <MaterialReadingContext value={store}>{children}</MaterialReadingContext>
  );
}
export function useMaterialReading(materialId?: string) {
  const store = useContext(MaterialReadingContext);
  const reading = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const { register } = reading;
  useEffect(
    () => (materialId === undefined ? undefined : register(materialId)),
    [register, materialId],
  );
  return {
    ...reading,
    state:
      materialId === undefined ? undefined : reading.states.get(materialId),
  };
}
