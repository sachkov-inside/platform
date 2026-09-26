import { HomeFeedLoading } from "./home-feed.client";
import { HomeFrame } from "./home-frame";

/** Мгновенный экран перехода на главную: закреп ещё не известен, поэтому только лента (#562). */
export function HomeLoading() {
  return (
    <HomeFrame>
      <HomeFeedLoading />
    </HomeFrame>
  );
}
