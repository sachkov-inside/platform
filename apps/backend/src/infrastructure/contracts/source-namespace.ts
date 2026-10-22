import { z } from "zod";

/**
 * The part of a source ID before its first `:`, naming the content repository that owns it, for
 * example `inside-content`. Materials and Product Tasks read the state of one namespace with the
 * same rule, so the value lives here, below both Modules.
 */
export const sourceNamespaceSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
