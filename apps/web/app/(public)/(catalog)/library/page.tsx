import type { Metadata } from "next";

import { LibraryPageQuery } from "@/_pages/library";

export const metadata: Metadata = {
  title: "База знаний",
};

export default function LibraryRoute() {
  return <LibraryPageQuery />;
}
