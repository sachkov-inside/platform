import { contractDigest } from "../../../infrastructure/contracts/canonical-digest.js";
import type { TaskDefinition } from "./task-definition-schema.js";
export {
  taskCodeSchema,
  taskSourceIdSchema,
  criterionLevelSchema,
  taskAccessSchema,
  taskPublicationSchema,
  submissionSourceSchema,
  taskDefinitionSchema,
  taskProvenanceSchema,
  type SubmissionSource,
  type TaskDefinition,
  type TaskProvenance,
} from "./task-definition-schema.js";

/** Only the definition decides whether an import creates a new Task Version. */
export function taskDefinitionDigest(definition: TaskDefinition): string {
  return contractDigest(definition);
}
