import { connection } from "next/server";

import { handlePersonCardRequest } from "@/_pages/authoring-person.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly accountId: string }> },
): Promise<Response> {
  await connection();
  const { accountId } = await params;
  return handlePersonCardRequest(accountId);
}
