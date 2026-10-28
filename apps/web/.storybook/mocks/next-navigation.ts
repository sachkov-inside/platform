import { fn } from "storybook/test";
import { ReadonlyURLSearchParams } from "next/dist/client/components/readonly-url-search-params";

export { ReadonlyURLSearchParams };

const router = {
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => Promise.resolve(),
  push: () => undefined,
  refresh: () => undefined,
  replace: () => undefined,
};

export const usePathname = fn((): string => "/");

/** Параметры маршрута: story задаёт их через `mocked(useParams).mockReturnValue(...)`. */
export const useParams = fn((): Record<string, string | string[]> => ({}));

export function useRouter() {
  return router;
}

/** Story fixtures configure the external router before rendering production hooks. */
export function getStoryRouter() {
  return router;
}

export const useSearchParams = fn(
  (): ReadonlyURLSearchParams => new ReadonlyURLSearchParams(),
);
