import "server-only";

import { cache } from "react";

import { getPublishedTopic } from "./get-published-topic";

export const loadPublishedTopic = cache(getPublishedTopic);
