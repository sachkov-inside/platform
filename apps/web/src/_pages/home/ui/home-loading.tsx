import { HomeFeedLoading } from "./home-feed.client";
import { HomeFrame } from "./home-frame";

/** Reserve the compact featured course and feed in their current responsive layout. */
export function HomeLoading() {
  return (
    <HomeFrame>
      <div
        className="home-product-course animate-pulse motion-reduce:animate-none"
        aria-hidden="true"
      >
        <div className="home-course-heading">
          <div className="h-8 w-48 max-w-full rounded-lg bg-muted" />
          <div className="home-course-description w-full">
            <div className="h-4 w-full rounded bg-muted/80" />
            <div className="mt-2 h-4 w-11/12 rounded bg-muted/80" />
            <div className="mt-2 h-4 w-3/4 rounded bg-muted/80" />
          </div>
        </div>
        <div className="home-course-visual">
          <div className="home-course-film">
            <div className="aspect-[3/2] rounded-[1.25rem] bg-muted" />
          </div>
          <div className="home-course-call">
            <div className="h-11 w-36 shrink-0 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
      <HomeFeedLoading />
    </HomeFrame>
  );
}
