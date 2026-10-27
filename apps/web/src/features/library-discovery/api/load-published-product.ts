import "server-only";

import { cache } from "react";

import { getPublishedProduct } from "./get-published-product";

export const loadPublishedProduct = cache(getPublishedProduct);
