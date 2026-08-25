import type { Metadata } from "next";

import { getLibraryCatalog, LibraryPage } from "@/_pages/library.server";

export const metadata: Metadata = {
  title: "Библиотека",
};

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly after?: string | readonly string[] | undefined;
  }>;
}) {
  const { after } = await searchParams;
  if (after !== undefined && typeof after !== "string") {
    throw new TypeError("Library cursor must be singular");
  }
  const result = await getLibraryCatalog(after);
  return <LibraryPage result={result} />;
}
