import { z } from "zod";

export interface CommunityDiscussionsConfig {
  /** Absent means every topic, including the general topic. An empty list captures none. */
  readonly topicIds?: readonly number[];
}

export function loadCommunityDiscussionsConfig(
  environment: NodeJS.ProcessEnv,
): CommunityDiscussionsConfig | undefined {
  const enabled = environment["TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED"];
  const topics = environment["TELEGRAM_COMMUNITY_DISCUSSIONS_TOPIC_IDS"];
  if (enabled !== undefined && enabled !== "true" && enabled !== "false")
    throw new Error(
      "TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED must be true or false",
    );
  if (enabled !== "true") {
    if (topics !== undefined)
      throw new Error(
        "TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED=true is required with topic IDs",
      );
    return;
  }
  if (topics === undefined) return {};
  try {
    const topicIds = z
      .array(z.int().positive())
      .max(1000)
      .parse(JSON.parse(topics));
    return { topicIds: [...new Set(topicIds)] };
  } catch {
    throw new Error(
      "Invalid TELEGRAM_COMMUNITY_DISCUSSIONS_TOPIC_IDS: expected a JSON array of positive integer topic IDs",
    );
  }
}
