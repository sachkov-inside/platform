import { handleHomePinReadRequest, handleHomePinWriteRequest } from "@/_pages/authoring-materials.server";
export function GET(): Promise<Response> { return handleHomePinReadRequest(); }
export function PUT(request: Request): Promise<Response> { return handleHomePinWriteRequest(request); }
