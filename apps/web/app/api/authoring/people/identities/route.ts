import { connection } from "next/server";

import { handlePeopleIdentitiesRequest } from "@/entities/authoring-person.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handlePeopleIdentitiesRequest(request);
}
