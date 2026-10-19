import { connection } from "next/server";

import { handleMaterialPublicLink } from "@/_pages/material-authoring.server";

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly materialId: string }> },
): Promise<Response> {
  await connection();
  const { materialId } = await context.params;
  return handleMaterialPublicLink(materialId);
}
