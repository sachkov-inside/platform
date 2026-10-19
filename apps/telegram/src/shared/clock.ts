export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("CLOCK");

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Elapsed-time deadlines must remain independent of wall-clock adjustments. */
export interface MonotonicClock {
  now(): number;
}
export const MONOTONIC_CLOCK = Symbol("MONOTONIC_CLOCK");
export const systemMonotonicClock: MonotonicClock = {
  now: () => performance.now(),
};
