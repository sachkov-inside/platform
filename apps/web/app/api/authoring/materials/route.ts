import {
  handleCreateMaterialRequest,
  handleSaveMaterialRequest,
} from "@/_pages/material-authoring.server";
import {
  handleDeleteMaterialDraftRequest,
  handleTransitionMaterialPublicationRequest,
} from "@/features/material-lifecycle.server";

export function POST(request: Request): Promise<Response> {
  return handleCreateMaterialRequest(request);
}

export function PUT(request: Request): Promise<Response> {
  return handleSaveMaterialRequest(request);
}

export function PATCH(request: Request): Promise<Response> {
  return handleTransitionMaterialPublicationRequest(request);
}

export function DELETE(request: Request): Promise<Response> {
  return handleDeleteMaterialDraftRequest(request);
}
