import { fn } from "storybook/test";
import { ReadonlyURLSearchParams } from "next/dist/client/components/navigation.react-server";

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

export const useSearchParams = fn(
  (): ReadonlyURLSearchParams => new ReadonlyURLSearchParams(),
);
