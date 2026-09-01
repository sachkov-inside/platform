import {
  handleAccountProfileRequest,
  handleCreateMemberProfileRequest,
  handleUpdateMemberProfileRequest,
} from "@/_pages/account.server";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handleAccountProfileRequest();
}

export function POST(request: Request): Promise<Response> {
  return handleCreateMemberProfileRequest(request);
}

export function PUT(request: Request): Promise<Response> {
  return handleUpdateMemberProfileRequest(request);
}
