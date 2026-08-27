import createClient from "openapi-fetch";

import type { paths } from "../../../../../src/shared/api/backend/generated/platform-api";

const client = createClient<paths>({ baseUrl: "http://127.0.0.1:3001" });

export const directCatalogRequest = client.GET("/library/materials");
