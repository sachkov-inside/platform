import Link from "next/link";

/** Owner-selected C wordmark. Keep the full accessible name at every viewport size. */
export function InsideBrand() {
  return (
    <Link
      href="/"
      aria-label="Sachkov Inside"
      className="flex shrink-0 flex-col rounded-md text-base font-extrabold leading-[1.1] tracking-[-0.045em] no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:flex-row sm:gap-[0.23em] sm:text-2xl sm:tracking-[-0.06em]"
    >
      <span>Sachkov</span> <span className="text-action">Inside</span>
    </Link>
  );
}
