import { Module, type OnApplicationShutdown } from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import {
  MaterialsModule,
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../materials/index.js";
import { assemblePracticeContextSource } from "./adapters/content-library/practice-context.js";
import { CourseAssistantController } from "./adapters/nest/course-assistant.controller.js";
import { CourseAssistant } from "./facets/course-assistant/course-assistant.js";
import {
  HttpGitHubApp,
  unconfiguredGitHubApp,
  unconfiguredRepositoryReader,
} from "./infrastructure/github/http-github-app.js";
import { PgBossReviewQueue } from "./infrastructure/queue/pg-boss-review-queue.js";

/** Постановка проверок из API; без настроенной модели очереди нет. */
class ReviewQueueLifecycle implements OnApplicationShutdown {
  constructor(readonly queue: PgBossReviewQueue | null) {}
  async onApplicationShutdown(): Promise<void> {
    await this.queue?.stop();
  }
}

// Контроллер зарегистрирован всегда: OpenAPI собирается без настроек, а закрытый помощник
// отвечает 404 из самой операции.
@Module({
  imports: [PrismaModule, AccountsModule, MaterialsModule],
  controllers: [CourseAssistantController],
  providers: [
    {
      provide: ReviewQueueLifecycle,
      inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig) =>
        new ReviewQueueLifecycle(
          config.courseAssistant.model === undefined
            ? null
            : new PgBossReviewQueue(config.database.url),
        ),
    },
    {
      provide: CourseAssistant,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        PLATFORM_CONFIG,
        PUBLISHED_MATERIAL_READER,
        CONTENT_ACCESS,
        ReviewQueueLifecycle,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        config: PlatformConfig,
        reader: PublishedMaterialReader,
        contentAccess: ContentAccess,
        reviews: ReviewQueueLifecycle,
      ) => {
        const githubApp =
          config.courseAssistant.githubApp === undefined
            ? undefined
            : new HttpGitHubApp(config.courseAssistant.githubApp);
        return new CourseAssistant({
          prisma,
          accounts,
          settings: config.courseAssistant,
          github: githubApp ?? unconfiguredGitHubApp,
          repositories: githubApp ?? unconfiguredRepositoryReader,
          practices: assemblePracticeContextSource({ reader, contentAccess }),
          reviewQueue: reviews.queue,
          clock: () => new Date(),
        });
      },
    },
  ],
})
export class CourseAssistantModule {}
