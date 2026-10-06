const catalogStaleSeconds = 60;

/** Next.js читает срок только из литерала в файле маршрута. */
export const unstable_dynamicStaleTime = catalogStaleSeconds;

export default function TopicRoute() {
  return <main />;
}
