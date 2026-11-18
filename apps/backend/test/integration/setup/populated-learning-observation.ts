import { performance } from "node:perf_hooks";

type LearningStage =
  | "beforeAll"
  | "database"
  | "rustfs-start-health"
  | "s3-buckets"
  | "identity-issuer"
  | "bootstrap-owner"
  | "owner-token"
  | "telegram-provider"
  | "api-port"
  | "bank-port"
  | "bank-provider"
  | "create-api-application"
  | "api-listen"
  | "api-url"
  | "holder-token"
  | "accounts-http"
  | "reading-feed-seed"
  | "learning-seed"
  | "cleanup"
  | "cleanup:api"
  | "cleanup:bank"
  | "cleanup:telegram"
  | "cleanup:identity"
  | "cleanup:rustfs"
  | "cleanup:database";

/** Named boundaries only, without fixture data or virtual Date values (#2417). */
export function reportLearningStage(
  stage: LearningStage,
  phase: "start" | "end" | "failed",
): void {
  console.info(
    JSON.stringify({
      diagnostic: "populated-learning",
      stage,
      phase,
      monotonicMs: performance.now(),
    }),
  );
}
