import { handleHomePinReadRequest, handleHomePinWriteRequest } from "@/features/series-order.server";
export function GET(): Promise<Response> { return handleHomePinReadRequest(); }
export function PUT(request: Request): Promise<Response> { return handleHomePinWriteRequest(request); }
