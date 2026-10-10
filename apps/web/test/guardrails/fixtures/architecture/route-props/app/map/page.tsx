import type { PageProps } from "./route-types";

/** Импортированный свой тип — не сгенерированный `PageProps`. */
export default async function MapRoute({ searchParams }: PageProps) {
  const query = await searchParams;
  return <main>{Object.keys(query).length}</main>;
}
