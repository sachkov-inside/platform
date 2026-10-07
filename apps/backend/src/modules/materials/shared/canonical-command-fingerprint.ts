import { preProductCommand } from "../../../infrastructure/contracts/pre-product-command.js";
import { commandDigest } from "../../../infrastructure/contracts/canonical-digest.js";

export function fingerprintCommand(value: unknown): string {
  return commandDigest({
    fingerprintVersion: 1,
    request: preProductCommand(value),
  });
}
