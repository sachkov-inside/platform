import type { Metadata } from "next";

import { AuthenticationFeedback, LibraryPageQuery } from "@/_pages/library";

export const metadata: Metadata = {
  title: "База знаний",
};

interface LibraryRouteProps {
  readonly searchParams: Promise<{
    readonly authentication?: string | readonly string[] | undefined;
  }>;
}

export default async function LibraryRoute({ searchParams }: LibraryRouteProps) {
  const authentication = (await searchParams).authentication;
  return (
    <>
      <AuthenticationFeedback
        authenticationError={typeof authentication === "string" ? authentication : undefined}
      />
      <LibraryPageQuery />
    </>
  );
}
