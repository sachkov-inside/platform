import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";
import "./product-landing-skeletons.css";

/** Motion follows the same preference as the loaded page. */
export const pulse = "animate-pulse motion-reduce:animate-none";

/** Match the current course landing: copy and animation, then the content sections. */
export function ProductLandingSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Продукт загружается"
      className="mx-auto min-h-svh w-full min-w-0 max-w-5xl"
      data-route-skeleton="product-landing"
    >
      <HideMobileNavigation />
      <div data-product-part="back">
        <div className={`h-11 w-32 rounded-lg bg-muted ${pulse}`} />
      </div>
      <div className="landing-skeleton-hero" data-product-part="hero">
        <div className={`landing-skeleton-copy ${pulse}`} aria-hidden="true">
          <div className="landing-skeleton-title h-12 w-4/5 rounded-lg bg-muted sm:h-16" />
          <div className="landing-skeleton-lead mt-4 grid gap-2">
            <div className="h-5 rounded bg-muted/80" />
            <div className="h-5 w-11/12 rounded bg-muted/80" />
          </div>
          <div className="landing-skeleton-points mt-7 grid gap-5">
            {[0, 1, 2].map((item) => (
              <div className="flex items-center gap-4" key={item}>
                <div className="size-9 shrink-0 rounded-xl bg-muted" />
                <div className="h-5 w-3/5 rounded bg-muted/80" />
              </div>
            ))}
          </div>
          <div className="landing-skeleton-action mt-7 h-12 w-48 rounded-xl bg-muted" />
        </div>
        <div
          className={`landing-skeleton-film aspect-[3/2] w-full rounded-[1.25rem] bg-muted ${pulse}`}
          aria-hidden="true"
        />
      </div>
      <SectionSkeleton />
      <SectionSkeleton />
      <p className="sr-only">Загружаем страницу продукта</p>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className={`mt-10 ${pulse}`} aria-hidden="true">
      <div className="h-7 w-1/2 rounded-lg bg-muted md:h-8" />
      <div className="mt-4 grid gap-2">
        <div className="h-6 w-full rounded-md bg-muted/80" />
        <div className="h-6 w-11/12 rounded-md bg-muted/80" />
        <div className="h-6 w-4/5 rounded-md bg-muted/80" />
      </div>
    </div>
  );
}
