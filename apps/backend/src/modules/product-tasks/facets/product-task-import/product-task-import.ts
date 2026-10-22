import type {
  ApplySourceTaskOperation,
  ValidateSourceTaskOperation,
} from "../../features/import-product-task/import-product-task.contract.js";
import {
  assembleApplySourceTask,
  assembleValidateSourceTask,
  type TaskImportDependencies,
} from "../../features/import-product-task/import-product-task.js";
import type { ReadSourceTaskStateOperation } from "../../features/read-source-task-state/read-source-task-state.contract.js";
import { assembleReadSourceTaskState } from "../../features/read-source-task-state/read-source-task-state.js";

export const PRODUCT_TASK_IMPORT = Symbol("PRODUCT_TASK_IMPORT");

/**
 * What the authoring tool reaches of Product Tasks: validate and apply one source task, and read
 * the state of one source namespace before deciding what to write.
 */
export interface ProductTaskImport {
  readonly validate: ValidateSourceTaskOperation;
  readonly apply: ApplySourceTaskOperation;
  readonly readState: ReadSourceTaskStateOperation;
}

export function assembleProductTaskImport(
  dependencies: TaskImportDependencies,
): ProductTaskImport {
  return Object.freeze<ProductTaskImport>({
    validate: assembleValidateSourceTask(dependencies),
    apply: assembleApplySourceTask(dependencies),
    readState: assembleReadSourceTaskState(dependencies),
  });
}
