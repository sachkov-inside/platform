import { proxyProfileAvatarMutation } from "@/_pages/account.server";

export function PUT(request: Request): Promise<Response> {
  return proxyProfileAvatarMutation(request);
}

export function DELETE(request: Request): Promise<Response> {
  return proxyProfileAvatarMutation(request);
}
