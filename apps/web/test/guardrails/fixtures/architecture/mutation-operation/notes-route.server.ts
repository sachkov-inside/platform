import "server-only";

import {
  handleAuthenticatedMutation,
  handleMutationOperation,
} from "@/shared/auth/index.server";

import { createNoteOperation } from "./create-note.operation";

export function handleNoteCreation(request: Request) {
  return handleMutationOperation(request, createNoteOperation, {
    execute: () => Promise.resolve({ kind: "created" as const }),
    invalidInput: () => ({ kind: "created" as const }),
  });
}

export function handleNoteForm(request: Request) {
  return handleAuthenticatedMutation(request, () => Promise.resolve(null));
}
