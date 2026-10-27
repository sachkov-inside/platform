import { connection } from "next/server";

import {
  handleAccountProfileRequest,
  handleCreateAccountProfileRequest,
  handleUpdateAccountProfileRequest,
} from "@/_pages/account.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAccountProfileRequest();
}

export function POST(request: Request): Promise<Response> {
  return handleCreateAccountProfileRequest(request);
}

export function PUT(request: Request): Promise<Response> {
  return handleUpdateAccountProfileRequest(request);
}
