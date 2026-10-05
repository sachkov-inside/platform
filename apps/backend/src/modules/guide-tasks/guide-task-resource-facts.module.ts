import { Global, Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  GUIDE_TASK_RESOURCE_FACTS,
  type GuideTaskResourceFactsAdapter,
} from "../content-access/index.js";
import { assembleGuideTaskResourceFacts } from "./adapters/content-access/guide-task-resource-facts.js";

/**
 * Guide Tasks' implementation of the Content Access Guide Task port. Global, because Materials
 * assembles Content Access and must not import Guide Tasks (ADR 0029); each process that loads
 * Materials imports this module in its entrypoint.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: GUIDE_TASK_RESOURCE_FACTS,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): GuideTaskResourceFactsAdapter =>
        assembleGuideTaskResourceFacts(prisma),
    },
  ],
  exports: [GUIDE_TASK_RESOURCE_FACTS],
})
export class GuideTaskResourceFactsModule {}
