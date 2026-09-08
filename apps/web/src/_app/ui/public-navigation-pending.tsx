import type { Route } from "next";
import { AccountLoading } from "@/_pages/account";
import { HomeLoading } from "@/_pages/home";
import { LibraryLoading } from "@/_pages/library";

/** An immediate mobile destination while App Router resolves its route; the dock stays above it. */
export function PublicNavigationPending({ href }: { readonly href: Route }) {
  const path = href.split("?")[0];
  return <div className="fixed inset-0 z-30 overflow-y-auto bg-background px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-7">
    <div className="mx-auto max-w-[61rem]">
      {path === "/account" ? <AccountLoading /> : path === "/library" ? <LibraryLoading /> : <HomeLoading />}
    </div>
  </div>;
}
