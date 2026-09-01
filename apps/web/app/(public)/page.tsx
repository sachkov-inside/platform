import { redirect } from "next/navigation";

interface HomeRouteProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function HomeRoute({ searchParams }: HomeRouteProps) {
  const query = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(await searchParams)) {
    if (typeof rawValue === "string") {
      query.append(name, rawValue);
      continue;
    }
    if (rawValue !== undefined) {
      for (const value of rawValue) {
        query.append(name, value);
      }
    }
  }

  redirect(query.size === 0 ? "/library" : `/library?${query.toString()}`);
}
