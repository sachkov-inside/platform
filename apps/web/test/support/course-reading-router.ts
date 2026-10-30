import { use, useSyncExternalStore } from "react";

let release: () => void;
const ready = new Promise<void>((resolve) => {
  release = resolve;
});
export function usePathname() {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("popstate", notify);
      return () => {
        window.removeEventListener("popstate", notify);
      };
    },
    () => window.location.pathname,
    () => window.location.pathname,
  );
}
export function useSearchParams() {
  use(ready);
  return new URLSearchParams(window.location.search);
}
export function releaseLocation() {
  release();
}
