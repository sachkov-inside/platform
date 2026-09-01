import "server-only";

import { cache } from "react";

import { getPublishedSeries } from "./get-published-series";

export const loadPublishedSeries = cache(getPublishedSeries);
