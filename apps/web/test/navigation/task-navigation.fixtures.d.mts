export const taskNavigationSlug: "navigation-tasks";
export const protectedTaskMarker: "ЗАКРЫТОЕ-ТЕЛО-ЗАДАНИЯ";
export function holdNavigationTasks(hold: boolean): void;
export function waitNavigationTask(path: string): Promise<void>;
export function navigationTaskRoute(
  url: URL,
  authorized: boolean,
): { readonly status: number; readonly value: unknown } | undefined;
