import { fn } from "storybook/test";

const router = {
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => Promise.resolve(),
  push: () => undefined,
  refresh: () => undefined,
  replace: () => undefined,
};

export const usePathname = fn((): string => "/");

export function useRouter() {
  return router;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}
