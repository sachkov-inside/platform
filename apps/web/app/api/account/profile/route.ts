import { connection } from "next/server";

import {
  handleAccountProfileRequest,
  handleCreateMemberProfileRequest,
  handleUpdateMemberProfileRequest,
} from "@/_pages/account.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAccountProfileRequest();
}

export function POST(request: Request): Promise<Response> {
  return handleCreateMemberProfileRequest(request);
}

export function PUT(request: Request): Promise<Response> {
  return handleUpdateMemberProfileRequest(request);
}
