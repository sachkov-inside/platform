/** Small fixed CI corpus; PROPERTY_SEED selects one unsigned 32-bit replay. */
export function propertySeeds(): readonly number[] {
  const replay = process.env["PROPERTY_SEED"];
  if (replay === undefined) return [1, 7, 42, 2245];
  if (!/^\d+$/.test(replay) || Number(replay) > 0xffffffff)
    throw new Error("PROPERTY_SEED must be an unsigned 32-bit integer");
  return [Number(replay)];
}

export function boundedSequence<T>(
  seed: number,
  alphabet: readonly T[],
  length: number,
): T[] {
  let state = seed >>> 0;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const item = alphabet[state % alphabet.length];
    if (item === undefined) throw new Error("Empty sequence alphabet");
    return item;
  });
}

/** Greedy deletion, capped at 32 replays; each replay must create fresh state. */
export async function checkSequence<T>(
  seed: number,
  sequence: readonly T[],
  run: (steps: readonly T[]) => Promise<void>,
): Promise<void> {
  try {
    await run(sequence);
  } catch (cause) {
    let smallest = [...sequence];
    let budget = 32;
    for (let index = 0; index < smallest.length && budget > 0;) {
      const candidate = smallest.filter((_, i) => i !== index);
      budget--;
      try {
        await run(candidate);
        index++;
      } catch {
        smallest = candidate;
      }
    }
    throw new Error(
      `PROPERTY_SEED=${seed}; trace=${JSON.stringify(sequence)}; reduced=${JSON.stringify(smallest)}`,
      { cause },
    );
  }
}
