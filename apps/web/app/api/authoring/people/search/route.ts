import { connection } from "next/server";

import { handlePeopleSearchRequest } from "@/entities/authoring-person.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handlePeopleSearchRequest(request);
}
