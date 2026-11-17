"use client";

import { connectBodyFragments } from "../lib/body-fragments.browser";

/** Connect only after the real body arrives, including a streamed or retained destination. */
export function BodyFragmentNavigation() {
  return <span hidden ref={connectBodyFragments} />;
}
