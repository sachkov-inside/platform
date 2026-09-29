import type { CourseAssistantPrismaClient } from "../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../accounts/index.js";
import type { CourseAssistantSettings } from "../domain/course-assistant-settings.js";
import type { GitHubApp } from "../ports/github-app.js";
import type { PracticeContextSource } from "../ports/practice-context.js";
import type { RepositoryReader } from "../ports/repository-reader.js";
import type { ReviewQueue } from "../ports/review-queue.js";

export interface CourseAssistantDependencies {
  readonly prisma: CourseAssistantPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly settings: CourseAssistantSettings;
  readonly github: GitHubApp;
  readonly repositories: RepositoryReader;
  readonly practices: PracticeContextSource;
  /** `null` — модель проверки не настроена: проверку поставить нельзя. */
  readonly reviewQueue: ReviewQueue | null;
  readonly clock: () => Date;
}

export type CourseAssistantError =
  | { readonly code: "unavailable" }
  | { readonly code: "invalid_request" }
  | { readonly code: "dependency_unavailable" };

export const unavailable = {
  ok: false,
  error: { code: "unavailable" },
} as const;
export const invalidRequest = {
  ok: false,
  error: { code: "invalid_request" },
} as const;
export const dependencyUnavailable = {
  ok: false,
  error: { code: "dependency_unavailable" },
} as const;
