import { connection } from "next/server";

import { handlePeopleListRequest } from "@/_pages/authoring-people.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handlePeopleListRequest(request);
}
