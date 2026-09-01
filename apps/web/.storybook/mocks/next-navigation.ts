const router = {
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => Promise.resolve(),
  push: () => undefined,
  refresh: () => undefined,
  replace: () => undefined,
};

export function usePathname(): string {
  return "/";
}

export function useRouter() {
  return router;
}
