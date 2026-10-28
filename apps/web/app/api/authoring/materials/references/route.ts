import { connection } from "next/server";

import { handleAuthoringMaterialFiltersRequest } from "@/_pages/authoring-materials.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAuthoringMaterialFiltersRequest();
}
