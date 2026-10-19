import "server-only";

import { ImageResponse } from "next/og";
import {
  SOCIAL_CARD_SIZE,
  type SocialCardContent,
} from "../model/social-card-content";
import { SocialCardArtwork } from "./social-card-artwork";

const SOCIAL_CARD_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

/** PNG and editor preview share one artwork; draft text is never sent to a public image route. */
export function socialCardResponse(content: SocialCardContent): ImageResponse {
  return new ImageResponse(SocialCardArtwork({ content }), {
    ...SOCIAL_CARD_SIZE,
    headers: { "cache-control": SOCIAL_CARD_CACHE_CONTROL },
  });
}
