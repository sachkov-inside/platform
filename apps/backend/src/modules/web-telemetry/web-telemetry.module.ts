import { Module } from "@nestjs/common";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { WebTelemetry } from "./facets/web-telemetry/web-telemetry.js";
import { WebTelemetryController } from "./adapters/nest/web-telemetry.controller.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  providers: [
    {
      provide: WebTelemetry,
      inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts) =>
        new WebTelemetry({ prisma, accounts }),
    },
  ],
  exports: [WebTelemetry],
})
export class WebTelemetryModule {}

@Module({
  imports: [WebTelemetryModule],
  controllers: [WebTelemetryController],
})
export class WebTelemetryHttpModule {}
