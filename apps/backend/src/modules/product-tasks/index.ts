export { ProductTasksModule } from "./product-tasks.module.js";
export { ProductTasksHttpModule } from "./product-tasks-http.module.js";
export { ProductTaskResourceFactsModule } from "./product-task-resource-facts.module.js";
export {
  assembleLearningTasks,
  LEARNING_TASKS,
  type LearningTasks,
} from "./facets/learning-tasks/learning-tasks.js";
export {
  learningTaskInstructions,
  registerLearningTaskTools,
} from "./adapters/mcp/learning-tasks-mcp.js";
