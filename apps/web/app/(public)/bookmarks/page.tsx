import type { Metadata } from "next";
import { Suspense } from "react";

import {
  BookmarksLoading,
  BookmarksPage,
  BookmarksPageQuery,
} from "@/_pages/bookmarks";

export const metadata: Metadata = {
  title: "Закладки",
  robots: { follow: false, index: false },
};

export default function BookmarksRoute() {
  return (
    <BookmarksPage>
      <Suspense fallback={<BookmarksLoading />}>
        <BookmarksPageQuery />
      </Suspense>
    </BookmarksPage>
  );
}
