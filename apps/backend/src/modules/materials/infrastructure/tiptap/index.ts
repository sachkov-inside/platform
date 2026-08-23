import { createMaterialDocumentOperations } from "../../domain/material-document/material-document.js";
import { roundTripTiptapDocument } from "./tiptap-adapter.js";

export const materialDocumentOperations = createMaterialDocumentOperations(
  roundTripTiptapDocument,
);
