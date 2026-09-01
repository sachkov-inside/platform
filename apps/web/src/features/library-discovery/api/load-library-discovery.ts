import "server-only";

import { cache } from "react";

import type { LibraryDiscoveryKind } from "../model/library-discovery-view";
import {
  getPublishedSeries,
  getPublishedTopic,
} from "./get-library-discovery";

export const loadLibraryDiscovery = cache(
  (
    kind: Exclude<LibraryDiscoveryKind, "related">,
    slug: string,
    accessToken?: string,
  ) =>
    kind === "topic"
      ? getPublishedTopic(slug, accessToken)
      : getPublishedSeries(slug, accessToken),
);
