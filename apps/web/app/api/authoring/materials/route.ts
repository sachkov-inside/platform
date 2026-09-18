import { connection } from "next/server";

import {
  handleCreateMaterialRequest,
  handleSaveMaterialRequest,
} from "@/_pages/material-authoring.server";
import { handleAuthoringMaterialsRequest } from "@/_pages/authoring-materials.server";
import {
  handleDeleteMaterialDraftRequest,
  handleTransitionMaterialPublicationRequest,
} from "@/features/material-lifecycle.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleAuthoringMaterialsRequest(request);
}

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
