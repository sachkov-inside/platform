import { connection } from "next/server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { loadLearningPractices } from "../api/load-learning-practices.server";
import { LearningPracticePrompts } from "./learning-practice-prompts";

export async function SavedLearningPractices({
  slug,
}: {
  readonly slug: string;
}) {
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  if (accessToken === undefined) return null;
  return (
    <LearningPracticePrompts
      result={await loadLearningPractices(slug, accessToken)}
    />
  );
}
