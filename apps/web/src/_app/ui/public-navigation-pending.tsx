import type { Route } from "next";
import { AccountLoading } from "@/_pages/account";
import { HomeLoading } from "@/_pages/home";
import { NavigationPendingFrame } from "@/widgets/application-shell";

/** An immediate mobile destination while App Router resolves its route; the dock stays above it. */
export function PublicNavigationPending({ href }: { readonly href: Route }) {
  const path = href.split("?")[0];
  return <NavigationPendingFrame>
    {path === "/account" ? <AccountLoading /> : <HomeLoading />}
  </NavigationPendingFrame>;
}
