import { ReadonlyURLSearchParams } from "next/dist/client/components/readonly-url-search-params";

export { ReadonlyURLSearchParams };

/** Navigation of the light preview: every transition is a page load of the preview address. */
const router = {
  back: () => {
    window.history.back();
  },
  forward: () => {
    window.history.forward();
  },
  prefetch: () => Promise.resolve(),
  push: (href: string) => {
    window.location.assign(href);
  },
  refresh: () => undefined,
  replace: (href: string) => {
    window.location.replace(href);
  },
};

export function usePathname(): string {
  return window.location.pathname;
}

export function useParams(): Record<string, string | string[]> {
  return {};
}

export function useRouter() {
  return router;
}

export function useSearchParams(): ReadonlyURLSearchParams {
  return new ReadonlyURLSearchParams(window.location.search);
}
