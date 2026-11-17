/**
 * Node module tests observe Next cache requests without a compiled cache store.
 * Own catalog policy stays real; the API/context limits live in docs/agents/testing.md.
 */
export const cacheLife = (): void => undefined;
export const cacheTag = (): void => undefined;
export const revalidateTag = (): void => undefined;
