import { signInReplyEligibility } from "./modules/bot-sign-in/reply-eligibility.js";
import { SIGN_IN_REPLY_ELIGIBILITY } from "./modules/outbound/sign-in-reply-eligibility.js";
import { linkEffects } from "./application/link-effects.js";
import { LINK_EFFECTS } from "./modules/identity-linking/link-effects.js";
import { contactEffects } from "./application/contact-effects.js";
import { CONTACT_EFFECTS } from "./modules/bot-contacts/contact-effects.js";
import { BLOCKED_DELIVERY } from "./modules/outbound/blocked-delivery.js";
import { settleBlockedDelivery } from "./modules/communications/delivery-contactability.js";
import { isTruthy } from "./shared/truthiness.js";
import { hasText } from "./shared/text.js";
import { InvitationRedemption } from "./modules/subscription-activation/invitation-redemption.js";
import { SubscriptionActivation } from "./modules/subscription-activation/subscription-activation.js";
import { SourceGroupProof } from "./modules/subscription-activation/source-group-proof.js";
import { ACTIVATION_PLATFORM } from "./modules/subscription-activation/activation-ports.js";
import { HttpActivationPlatform } from "./adapters/platform/http-activation-platform.adapter.js";
import { NotificationWorker } from "./operations/notification-worker.js";
import {
  AUTHOR_CONTENT_VALIDATION,
  DisabledAuthorContentValidation,
} from "./modules/communications/author-content-validation.js";
import { HttpAuthorContentValidationAdapter } from "./adapters/platform/http-author-content-validation.adapter.js";
import { AuthorAdmin } from "./modules/communications/author-admin.js";
import {
  AuthorDelivery,
  AUTHOR_TRANSPORT,
} from "./modules/communications/author-delivery.js";
import { CommunicationTracking } from "./modules/communications/communication-tracking.js";
import { Api } from "grammy";
import { Funnels } from "./modules/communications/funnels.js";
import { MarketingEntry } from "./modules/communications/marketing-entry.js";
import { FunnelScheduler } from "./modules/communications/funnel-scheduler.js";
import { COMMUNICATION_TRANSPORT } from "./modules/communications/communication-delivery.js";
import {
  GrammyCommunicationsAdapter,
  DisabledCommunicationTransport,
} from "./adapters/telegram/grammy-communications.adapter.js";
import { Communications } from "./modules/communications/communications.js";
import { CommunicationsController } from "./modules/communications/communications.controller.js";
import {
  AUTHOR_AUTHORIZATION,
  DisabledAuthorAuthorization,
} from "./modules/communications/author-authorization.js";
import { HttpAuthorAuthorizationAdapter } from "./adapters/platform/http-author-authorization.adapter.js";
import { Module, type DynamicModule } from "@nestjs/common";

import {
  DisabledMessagesAdapter,
  GrammyMessagesAdapter,
} from "./adapters/telegram/grammy-messages.adapter.js";
import { GrammyMembershipAdapter } from "./adapters/telegram/grammy-membership.adapter.js";
import { GrammyCommunityChatAdapter } from "./adapters/telegram/grammy-community-chat.adapter.js";
import { HttpCommunityAuthorization } from "./adapters/platform/http-community-authorization.adapter.js";
import { CommunityProvider } from "./modules/community/community-provider.js";
import { CommunityController } from "./modules/community/community.controller.js";
import {
  COMMUNITY_DISPATCH_AUTHORIZATION,
  DisabledCommunityDispatchAuthorization,
  DisabledTelegramCommunityChat,
  TELEGRAM_COMMUNITY_CHAT,
  type CommunityDispatchAuthorization,
  type TelegramCommunityChat,
} from "./modules/community/community-ports.js";
import { GrammyCallbackAnswersAdapter } from "./adapters/telegram/grammy-callback-answers.adapter.js";
import {
  TELEGRAM_CALLBACK_ANSWERS,
  DisabledTelegramCallbackAnswers,
} from "./modules/bot-sign-in/telegram-callback-answers.js";
import { HttpPlatformCohortAdapter } from "./adapters/platform/http-platform-cohort.adapter.js";
import { HttpSalesFunnelAdapter } from "./adapters/platform/http-sales-funnel.adapter.js";
import {
  SALES_FUNNEL_DELIVERY,
  type SalesFunnelDelivery,
} from "./modules/sales-funnel/sales-funnel-delivery.js";
import { SalesFunnelDeliveryProcessor } from "./modules/sales-funnel/sales-funnel-delivery-processor.js";
import { HttpPlatformEvidenceAdapter } from "./adapters/platform/http-platform-evidence.adapter.js";
import {
  botTelegramUserIdFromToken,
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "./config/application-config.js";
import { createDatabase } from "./database/create-database.js";
import { DATABASE, type Database } from "./database/database.js";
import { DatabaseLifecycle } from "./database/database-lifecycle.js";
import { BotContacts } from "./modules/bot-contacts/bot-contacts.js";
import { SignInAccountLink } from "./modules/bot-sign-in/sign-in-account-link.js";
import { BotSignIn } from "./modules/bot-sign-in/bot-sign-in.js";
import { BotSignInController } from "./modules/bot-sign-in/bot-sign-in.controller.js";
import { CLOCK, systemClock, type Clock } from "./shared/clock.js";
import { IdentityLinking } from "./modules/identity-linking/identity-linking.js";
import { IdentityLinkRecovery } from "./modules/identity-linking/identity-link-recovery.js";
import { IdentityLinkingController } from "./modules/identity-linking/identity-linking.controller.js";
import { InMemoryIdentityLinkingAdapter } from "./modules/identity-linking/in-memory-identity-linking.adapter.js";
import { InitialMembershipCheckProcessor } from "./modules/membership-evidence/initial-membership-check-processor.js";
import { InitialMembershipCheckQueue } from "./modules/membership-evidence/initial-membership-check-queue.js";
import { MembershipEvidenceDeliveryProcessor } from "./modules/membership-evidence/membership-evidence-delivery-processor.js";
import { MembershipEvidenceOutbox } from "./modules/membership-evidence/membership-evidence-outbox.js";
import { MembershipEvidenceProvider } from "./modules/membership-evidence/membership-evidence-provider.js";
import {
  DisabledPlatformEvidenceDelivery,
  PLATFORM_EVIDENCE_DELIVERY,
  type PlatformEvidenceDelivery,
} from "./modules/membership-evidence/platform-evidence-delivery.js";
import {
  DisabledTelegramMembership,
  TELEGRAM_MEMBERSHIP,
  type TelegramMembership,
} from "./modules/membership-evidence/telegram-membership.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramMessages,
} from "./modules/outbound/telegram-messages.js";
import { StartResponseDeliveryProcessor } from "./modules/outbound/start-response-delivery-processor.js";
import { StartResponseDeliveryQueue } from "./modules/outbound/start-response-delivery-queue.js";
import { TelegramUpdateInbox } from "./modules/update-inbox/telegram-update-inbox.js";
import { TelegramUpdateProcessor } from "./modules/update-inbox/telegram-update-processor.js";
import { TELEGRAM_UPDATE_TRANSLATOR } from "./modules/update-inbox/telegram-update-command.js";
import { GrammyUpdateAdapter } from "./adapters/telegram/grammy-update.adapter.js";
import { TelegramWebhook } from "./modules/webhook/telegram-webhook.js";
import { TelegramWebhookController } from "./modules/webhook/telegram-webhook.controller.js";
import { BackgroundWorkers } from "./operations/background-workers.js";
import { OperationsController } from "./operations/operations.controller.js";
import { RuntimeMetrics } from "./operations/runtime-metrics.js";
import { RUNTIME_COUNTERS } from "./shared/runtime-counters.js";

@Module({})
export class AppModule {
  static register(config: ApplicationConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        BotSignInController,
        CommunityController,
        CommunicationsController,
        IdentityLinkingController,
        OperationsController,
        TelegramWebhookController,
      ],
      providers: [
        {
          provide: SIGN_IN_REPLY_ELIGIBILITY,
          useValue: signInReplyEligibility,
        },
        { provide: LINK_EFFECTS, useValue: linkEffects },
        { provide: CONTACT_EFFECTS, useValue: contactEffects },
        { provide: BLOCKED_DELIVERY, useValue: settleBlockedDelivery },
        SubscriptionActivation,
        InvitationRedemption,
        {
          provide: ACTIVATION_PLATFORM,
          useFactory: () =>
            config.activation
              ? new HttpActivationPlatform(
                  config.activation.endpoint,
                  config.activation.secret,
                )
              : {
                  begin: () => Promise.resolve(),
                  binding: () => Promise.resolve(),
                  evidence: () => Promise.resolve(),
                  own: () => Promise.resolve(),
                  redeem: () => Promise.resolve(),
                },
        },
        {
          provide: SourceGroupProof,
          useFactory: () =>
            new SourceGroupProof(
              config.activation?.sources ?? [],
              isTruthy(config.activation?.enabled) && hasText(config.botToken)
                ? new GrammyMembershipAdapter(config.botToken)
                : new DisabledTelegramMembership(),
            ),
        },

        {
          provide: TELEGRAM_CALLBACK_ANSWERS,
          useFactory: () =>
            config.deliveryMode === "live" && hasText(config.botToken)
              ? new GrammyCallbackAnswersAdapter(config.botToken)
              : new DisabledTelegramCallbackAnswers(),
        },
        { provide: APPLICATION_CONFIG, useValue: config },
        { provide: CLOCK, useValue: systemClock },
        {
          provide: DATABASE,
          inject: [APPLICATION_CONFIG],
          useFactory: (applicationConfig: ApplicationConfig) =>
            createDatabase(applicationConfig.databaseUrl),
        },
        {
          provide: TELEGRAM_MESSAGES,
          inject: [APPLICATION_CONFIG],
          useFactory: (
            applicationConfig: ApplicationConfig,
          ): TelegramMessages => {
            if (
              applicationConfig.deliveryMode === "live" &&
              hasText(applicationConfig.botToken)
            ) {
              return new GrammyMessagesAdapter(applicationConfig.botToken);
            }
            return new DisabledMessagesAdapter();
          },
        },
        {
          provide: TELEGRAM_MEMBERSHIP,
          inject: [APPLICATION_CONFIG],
          useFactory: (
            applicationConfig: ApplicationConfig,
          ): TelegramMembership => {
            if (
              applicationConfig.membershipMode === "live" &&
              hasText(applicationConfig.botToken)
            ) {
              return new GrammyMembershipAdapter(applicationConfig.botToken);
            }
            return new DisabledTelegramMembership();
          },
        },
        {
          provide: TELEGRAM_COMMUNITY_CHAT,
          inject: [APPLICATION_CONFIG],
          useFactory: (
            applicationConfig: ApplicationConfig,
          ): TelegramCommunityChat =>
            applicationConfig.communityMode === "live" &&
            hasText(applicationConfig.botToken)
              ? new GrammyCommunityChatAdapter(applicationConfig.botToken)
              : new DisabledTelegramCommunityChat(),
        },
        {
          provide: COMMUNITY_DISPATCH_AUTHORIZATION,
          inject: [APPLICATION_CONFIG],
          useFactory: (
            applicationConfig: ApplicationConfig,
          ): CommunityDispatchAuthorization =>
            hasText(applicationConfig.communityDispatchUrl) &&
            hasText(applicationConfig.communityDispatchSecret)
              ? new HttpCommunityAuthorization(
                  applicationConfig.communityDispatchUrl,
                  applicationConfig.communityDispatchSecret,
                )
              : new DisabledCommunityDispatchAuthorization(),
        },
        {
          provide: CommunityProvider,
          inject: [
            DATABASE,
            APPLICATION_CONFIG,
            CLOCK,
            COMMUNITY_DISPATCH_AUTHORIZATION,
            TELEGRAM_COMMUNITY_CHAT,
            StartResponseDeliveryQueue,
          ],
          useFactory: (
            database: Database,
            applicationConfig: ApplicationConfig,
            clock: Clock,
            authorization: CommunityDispatchAuthorization,
            chat: TelegramCommunityChat,
            replies: StartResponseDeliveryQueue,
          ) =>
            new CommunityProvider(
              database,
              applicationConfig.botIdentity,
              applicationConfig.canonicalChatId,
              clock,
              authorization,
              chat,
              {
                ...(hasText(applicationConfig.botToken)
                  ? {
                      botTelegramUserId: botTelegramUserIdFromToken(
                        applicationConfig.botToken,
                      ),
                    }
                  : {}),
                ...(hasText(applicationConfig.communityContractVersion)
                  ? {
                      contractVersion:
                        applicationConfig.communityContractVersion,
                    }
                  : {}),
                ...(applicationConfig.communityRemovalsEnabled !== undefined
                  ? {
                      removalsEnabled:
                        applicationConfig.communityRemovalsEnabled,
                    }
                  : {}),
                ...(hasText(applicationConfig.communityTributeBotTelegramUserId)
                  ? {
                      tributeBotTelegramUserId:
                        applicationConfig.communityTributeBotTelegramUserId,
                      readmission: {
                        replies,
                        text: applicationConfig.communityTexts.readmission,
                      },
                    }
                  : {}),
                welcome: {
                  replies,
                  text: applicationConfig.communityTexts.welcome,
                },
                ...(applicationConfig.communityWelcomeCohort
                  ? {
                      welcomeDetails: new HttpPlatformCohortAdapter(
                        applicationConfig.communityWelcomeCohort.url,
                        applicationConfig.communityWelcomeCohort.productId,
                      ),
                    }
                  : {}),
                reconciliationCadenceMs:
                  applicationConfig.communityReconciliationCadenceMilliseconds,
              },
            ),
        },
        {
          provide: PLATFORM_EVIDENCE_DELIVERY,
          inject: [APPLICATION_CONFIG],
          useFactory: (
            applicationConfig: ApplicationConfig,
          ): PlatformEvidenceDelivery => {
            if (
              applicationConfig.evidenceDeliveryMode === "live" &&
              hasText(applicationConfig.platformEvidenceDeliveryUrl) &&
              hasText(applicationConfig.platformEvidenceDeliverySecret)
            ) {
              return new HttpPlatformEvidenceAdapter(
                applicationConfig.platformEvidenceDeliveryUrl,
                applicationConfig.platformEvidenceDeliverySecret,
              );
            }
            return new DisabledPlatformEvidenceDelivery();
          },
        },
        {
          provide: SALES_FUNNEL_DELIVERY,
          inject: [APPLICATION_CONFIG],
          useFactory: (
            applicationConfig: ApplicationConfig,
          ): SalesFunnelDelivery => {
            const delivery = applicationConfig.salesFunnel?.delivery;
            // Without a configured ingress no worker delivers; events stay queued.
            return delivery
              ? new HttpSalesFunnelAdapter(delivery.url, delivery.secret)
              : {
                  deliver: () =>
                    Promise.resolve({
                      kind: "retryable",
                      diagnosticCode: "sales_funnel_delivery_disabled",
                    }),
                };
          },
        },
        SalesFunnelDeliveryProcessor,
        AuthorAdmin,
        AuthorDelivery,
        {
          provide: AUTHOR_TRANSPORT,
          useFactory: () =>
            config.deliveryMode === "live" && hasText(config.botToken)
              ? new GrammyCommunicationsAdapter(
                  new Api(config.botToken, { timeoutSeconds: 10 }),
                )
              : new DisabledCommunicationTransport(),
        },
        CommunicationTracking,
        Communications,
        Funnels,
        MarketingEntry,
        FunnelScheduler,
        {
          provide: COMMUNICATION_TRANSPORT,
          useFactory: () =>
            config.marketingEnabled &&
            config.deliveryMode === "live" &&
            hasText(config.botToken)
              ? new GrammyCommunicationsAdapter(
                  new Api(config.botToken, { timeoutSeconds: 10 }),
                )
              : new DisabledCommunicationTransport(),
        },
        {
          provide: AUTHOR_AUTHORIZATION,
          useFactory: () =>
            hasText(config.platformAuthorAuthorizationUrl) &&
            hasText(config.platformAuthorAuthorizationSecret)
              ? new HttpAuthorAuthorizationAdapter(
                  config.platformAuthorAuthorizationUrl,
                  config.platformAuthorAuthorizationSecret,
                )
              : new DisabledAuthorAuthorization(),
        },
        {
          provide: AUTHOR_CONTENT_VALIDATION,
          useFactory: () =>
            hasText(config.platformAuthorContentValidationUrl) &&
            hasText(config.platformAuthorAuthorizationSecret)
              ? new HttpAuthorContentValidationAdapter(
                  config.platformAuthorContentValidationUrl,
                  config.platformAuthorAuthorizationSecret,
                )
              : new DisabledAuthorContentValidation(),
        },
        BackgroundWorkers,
        NotificationWorker,
        BotContacts,
        BotSignIn,
        SignInAccountLink,
        DatabaseLifecycle,
        IdentityLinking,
        IdentityLinkRecovery,
        InMemoryIdentityLinkingAdapter,
        InitialMembershipCheckProcessor,
        InitialMembershipCheckQueue,
        MembershipEvidenceDeliveryProcessor,
        MembershipEvidenceOutbox,
        MembershipEvidenceProvider,
        RuntimeMetrics,
        { provide: RUNTIME_COUNTERS, useExisting: RuntimeMetrics },
        TelegramUpdateInbox,
        TelegramUpdateProcessor,
        {
          provide: TELEGRAM_UPDATE_TRANSLATOR,
          useValue: new GrammyUpdateAdapter(),
        },
        TelegramWebhook,
        StartResponseDeliveryProcessor,
        StartResponseDeliveryQueue,
      ],
    };
  }
}
