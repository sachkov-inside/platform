import { expect } from "vitest";

export function stringMatching(pattern: RegExp): unknown {
  return expect.stringMatching(pattern);
}

export function notStringMatching(value: string): unknown {
  return expect.not.stringMatching(value);
}
