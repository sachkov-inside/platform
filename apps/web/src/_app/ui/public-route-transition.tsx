import type {} from "react/canary";
import { ViewTransition, type ReactNode } from "react";

/** Next's bundled React owns route commits; keep the clickable shell outside the snapshot. */
export function PublicRouteTransition({ children }: { readonly children: ReactNode }) {
  return (
    <ViewTransition default="none" enter="public-page" exit="public-page">
      <div>{children}</div>
    </ViewTransition>
  );
}
