import type {
  ApplicationResult,
  ContentAuthoringError,
} from "../content-authoring.interface.js";

export class AuthoringRollback extends Error {
  constructor(readonly applicationError: ContentAuthoringError) {
    super(applicationError.code);
  }
}

export function rollback(error: ContentAuthoringError): never {
  throw new AuthoringRollback(error);
}

export function failure<Value>(error: ContentAuthoringError): ApplicationResult<Value> {
  return { ok: false, error };
}
