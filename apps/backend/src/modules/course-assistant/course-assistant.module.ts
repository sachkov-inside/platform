import { Module } from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { CourseAssistantController } from "./adapters/nest/course-assistant.controller.js";
import { CourseAssistant } from "./facets/course-assistant/course-assistant.js";
import {
  HttpGitHubApp,
  unconfiguredGitHubApp,
} from "./infrastructure/github/http-github-app.js";

// Контроллер зарегистрирован всегда: OpenAPI собирается без настроек, а закрытый помощник
// отвечает 404 из самой операции.
@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [CourseAssistantController],
  providers: [
    {
      provide: CourseAssistant,
      inject: [PrismaClientProvider, ACCOUNTS, PLATFORM_CONFIG],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        config: PlatformConfig,
      ) =>
        new CourseAssistant({
          prisma,
          accounts,
          settings: config.courseAssistant,
          github:
            config.courseAssistant.githubApp === undefined
              ? unconfiguredGitHubApp
              : new HttpGitHubApp(config.courseAssistant.githubApp),
          clock: () => new Date(),
        }),
    },
  ],
})
export class CourseAssistantModule {}
