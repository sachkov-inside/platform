import type { Metadata } from "next";

import { Suspense } from "react";

import { LibraryLoading, LibraryPageQuery } from "@/_pages/library";
import { PublicRouteTransition } from "@/_app";

export const metadata: Metadata = {
  title: "База знаний",
};

export default function LibraryRoute() {
  return <PublicRouteTransition><Suspense fallback={<LibraryLoading />}><LibraryPageQuery /></Suspense></PublicRouteTransition>;
}
