import type { Metadata } from "next";

import { Suspense } from "react";

import { LibraryLoading, LibraryPageQuery } from "@/_pages/library";

export const metadata: Metadata = {
  title: "База знаний",
};

export default function LibraryRoute() {
  return <Suspense fallback={<LibraryLoading />}><LibraryPageQuery /></Suspense>;
}
