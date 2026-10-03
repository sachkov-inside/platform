import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  BillingGuideSales,
  BillingModule,
  BillingSurveyRespondentSales,
} from "../billing/index.js";
import { GuideOutlines, MaterialContentModule } from "../materials/index.js";
import {
  MaterialFirstOpens,
  ReadingActivityModule,
} from "../reading-activity/index.js";
import {
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import { SalesFunnel } from "./facets/sales-funnel/sales-funnel.js";
import { ReadFunnelReportController } from "./features/read-funnel-report/read-funnel-report.controller.js";
import { RecordBotEventsController } from "./features/record-bot-events/record-bot-events.controller.js";

@Module({
  imports: [
    PrismaModule,
    AccountsModule,
    BillingModule,
    MaterialContentModule,
    ReadingActivityModule,
    TelegramAccountLinksModule,
  ],
  controllers: [RecordBotEventsController, ReadFunnelReportController],
  providers: [
    {
      provide: SalesFunnel,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        TelegramAccountLinks,
        GuideOutlines,
        MaterialFirstOpens,
        BillingGuideSales,
        BillingSurveyRespondentSales,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        links: TelegramAccountLinks,
        outlines: GuideOutlines,
        firstOpens: MaterialFirstOpens,
        sales: BillingGuideSales,
        surveyRespondents: BillingSurveyRespondentSales,
      ) =>
        new SalesFunnel({
          prisma,
          accounts,
          links,
          outlines,
          firstOpens,
          sales,
          surveyRespondents,
          clock: () => new Date(),
        }),
    },
  ],
})
export class SalesFunnelModule {}
