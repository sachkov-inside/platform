import { connection } from "next/server";

import {
  handleHomePinReadRequest,
  handleHomePinWriteRequest,
} from "@/features/series-order.server";
export async function GET(): Promise<Response> {
  await connection();
  return handleHomePinReadRequest();
}
export function PUT(request: Request): Promise<Response> {
  return handleHomePinWriteRequest(request);
}
