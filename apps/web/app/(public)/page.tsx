import { HomePage } from "@/_pages/home";

export default async function HomeRoute({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authentication = (await searchParams).authentication;
  return (
    <HomePage
      authenticationError={typeof authentication === "string" ? authentication : undefined}
    />
  );
}
