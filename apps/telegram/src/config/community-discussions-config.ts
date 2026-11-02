import { hasText } from "../shared/text.js";
import { z } from "zod";
import {
  assertServiceEndpoint,
  assertServiceSecret,
} from "./service-secret.js";

export interface CommunityDiscussionsConfig {
  /** Absent means every topic, including the general topic. An empty list captures none. */
  readonly topicIds?: readonly number[];
  readonly secret?: string;
  readonly grouping?: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
  };
}

export function loadCommunityDiscussionsConfig(
  environment: NodeJS.ProcessEnv,
): CommunityDiscussionsConfig | undefined {
  const enabled = environment["TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED"];
  const topics = environment["TELEGRAM_COMMUNITY_DISCUSSIONS_TOPIC_IDS"];
  const secret = environment["PLATFORM_COMMUNITY_DISCUSSIONS_SECRET"]?.trim();
  const baseUrl = environment["COMMUNITY_DISCUSSIONS_MODEL_BASE_URL"]?.trim();
  const apiKey = environment["COMMUNITY_DISCUSSIONS_MODEL_API_KEY"]?.trim();
  const model = environment["COMMUNITY_DISCUSSIONS_MODEL"]?.trim();
  if (enabled !== undefined && enabled !== "true" && enabled !== "false")
    throw new Error(
      "TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED must be true or false",
    );
  if (enabled !== "true") {
    if (
      [topics, secret, baseUrl, apiKey, model].some(
        (value) => value !== undefined,
      )
    )
      throw new Error(
        "TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED=true is required with discussion settings",
      );
    return;
  }
  if (secret !== undefined)
    assertServiceSecret(secret, "PLATFORM_COMMUNITY_DISCUSSIONS_SECRET");
  let grouping: CommunityDiscussionsConfig["grouping"];
  if ([baseUrl, apiKey, model].some((value) => value !== undefined)) {
    if (!hasText(baseUrl) || !hasText(apiKey) || !hasText(model))
      throw new Error(
        "Discussion grouping requires COMMUNITY_DISCUSSIONS_MODEL_BASE_URL, COMMUNITY_DISCUSSIONS_MODEL_API_KEY and COMMUNITY_DISCUSSIONS_MODEL together",
      );
    assertServiceEndpoint(baseUrl, "COMMUNITY_DISCUSSIONS_MODEL_BASE_URL");
    grouping = { baseUrl, apiKey, model };
  }
  let topicIds: number[] | undefined;
  if (topics !== undefined) {
    try {
      topicIds = [
        ...new Set(
          z.array(z.int().positive()).max(1000).parse(JSON.parse(topics)),
        ),
      ];
    } catch {
      throw new Error(
        "Invalid TELEGRAM_COMMUNITY_DISCUSSIONS_TOPIC_IDS: expected a JSON array of positive integer topic IDs",
      );
    }
  }
  return {
    ...(topicIds ? { topicIds } : {}),
    ...(secret !== undefined ? { secret } : {}),
    ...(grouping ? { grouping } : {}),
  };
}
