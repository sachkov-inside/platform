import { acceptMaterialBody } from "../../domain/material-body/accept-material-body.js";
import { applyMaterialBodyChanges } from "../../domain/material-body/apply-material-body-changes.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import {
  extractMaterialBody,
  renderMaterialBody,
} from "../../domain/material-body/render-material-body.js";
import { roundTripTiptapDocument } from "./tiptap-adapter.js";

const accept: MaterialBodyOperations["accept"] = (input, options) =>
  acceptMaterialBody(input, roundTripTiptapDocument, options);

export const materialBodyOperations: MaterialBodyOperations = {
  accept,
  applyChanges: (document, changes) =>
    applyMaterialBodyChanges(document, changes, accept),
  render: (document) => {
    const accepted = accept(document);
    return accepted.ok
      ? { ok: true, value: renderMaterialBody(accepted.value) }
      : accepted;
  },
  extract: (document) => {
    const accepted = accept(document);
    return accepted.ok
      ? {
          ok: true,
          value: extractMaterialBody(renderMaterialBody(accepted.value)),
        }
      : accepted;
  },
};
