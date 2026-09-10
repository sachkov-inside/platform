// Wall time that never answers twice in the same millisecond. Two readings landing inside one
// millisecond is luck, not a guarantee, so a value assembled from two readings fails here instead
// of at random on a loaded machine. `source` lets a scenario keep its own controlled instant.
export function distinctClock(source: () => number = Date.now): () => Date {
  let reading = 0;
  return () => {
    reading = Math.max(reading + 1, source());
    return new Date(reading);
  };
}
