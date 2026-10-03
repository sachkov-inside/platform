import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import {
  MaterialsModule,
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../materials/index.js";
import { assemblePracticeContextSource } from "./adapters/content-library/practice-context.js";
import { PracticeReviewer } from "./facets/practice-reviewer/practice-reviewer.js";
import {
  HttpGitHubApp,
  unconfiguredRepositoryReader,
} from "./infrastructure/github/http-github-app.js";
import { openAiCompatibleReviewModel } from "./infrastructure/model/openai-compatible-review-model.js";

/**
 * Worker помощника курса (#788). Без включённого помощника или без модели проверки в процессе нет
 * проверяющего: worker работает, но заданий не берёт.
 */
@Module({
  imports: [PrismaModule, MaterialsModule],
  providers: [
    {
      provide: PracticeReviewer,
      inject: [
        PrismaClientProvider,
        PLATFORM_CONFIG,
        PUBLISHED_MATERIAL_READER,
        CONTENT_ACCESS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        config: PlatformConfig,
        reader: PublishedMaterialReader,
        contentAccess: ContentAccess,
      ): PracticeReviewer | null => {
        const settings = config.courseAssistant;
        if (!settings.enabled || settings.model === undefined) return null;
        return new PracticeReviewer({
          prisma,
          repositories:
            settings.githubApp === undefined
              ? unconfiguredRepositoryReader
              : new HttpGitHubApp(settings.githubApp),
          practices: assemblePracticeContextSource({ reader, contentAccess }),
          model: openAiCompatibleReviewModel(
            settings.model,
            settings.reviewLimits,
          ),
          snapshotDirectory: join(tmpdir(), "inside-course-assistant"),
          clock: () => new Date(),
        });
      },
    },
  ],
  exports: [PracticeReviewer],
})
export class PracticeReviewerModule {}
