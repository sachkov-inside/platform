import type { Metadata } from "next";

import { LibraryPageQuery } from "@/_pages/library";
import { AuthenticationFeedback } from "@/shared/ui/authentication-feedback";

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
