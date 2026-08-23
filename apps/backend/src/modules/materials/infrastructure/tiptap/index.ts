import { acceptDocument } from "../../domain/material-body/accept-document.js";
import { applyDocumentChanges } from "../../domain/material-body/apply-document-changes.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import {
  extractMaterialDocument,
  renderMaterialDocument,
} from "../../domain/material-body/render-document.js";
import { roundTripTiptapDocument } from "./tiptap-adapter.js";

const accept: MaterialBodyOperations["accept"] = (input, options) =>
  acceptDocument(input, roundTripTiptapDocument, options);

export const materialDocumentOperations: MaterialBodyOperations = {
  accept,
  applyChanges: (document, changes) =>
    applyDocumentChanges(document, changes, accept),
  render: (document) => {
    const accepted = accept(document);
    return accepted.ok
      ? { ok: true, value: renderMaterialDocument(accepted.value) }
      : accepted;
  },
  extract: (document) => {
    const accepted = accept(document);
    return accepted.ok
      ? {
          ok: true,
          value: extractMaterialDocument(renderMaterialDocument(accepted.value)),
        }
      : accepted;
  },
};
