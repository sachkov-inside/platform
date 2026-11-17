import type {
  ContentCollection,
  ContentCollectionMutationResult,
} from "./content-collections";

/** Accepted server receipts belong to the page, including its retained draft editors. */
export function createContentCollectionState(
  initialCollections: readonly ContentCollection[],
) {
  let collections = initialCollections;
  const listeners = new Set<() => void>();
  const collection = (id: string): ContentCollection => {
    const found = collections.find((item) => item.id === id);
    if (found === undefined)
      throw new Error(`Unknown content collection: ${id}`);
    return found;
  };
  return {
    collection,
    getSnapshot: () => collections,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    accept: (result: ContentCollectionMutationResult) => {
      if (result.kind !== "saved") return;
      const saved = result.collection;
      const existing = collections.find((item) => item.id === saved.id);
      // Keep command versions monotonic across retained editors (#2382).
      if (existing !== undefined && saved.version < existing.version) return;
      const next =
        existing === undefined
          ? [...collections, saved]
          : collections.map((item) => (item.id === saved.id ? saved : item));
      collections = next.sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const listener of listeners) listener();
    },
  };
}

export type ContentCollectionState = ReturnType<
  typeof createContentCollectionState
>;
