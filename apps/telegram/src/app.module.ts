import { TelegramUserActivity } from "./modules/update-inbox/telegram-user-activity.js";
import { TelegramUserActivityController } from "./modules/update-inbox/telegram-user-activity.controller.js";
import {
  TELEGRAM_OBSERVABILITY,
  disabledTelegramObservability,
  type TelegramObservability,
} from "./observability/telegram-observability.js";
import {
  NATIVE_MESSAGE_ARCHIVE,
  DisabledNativeMessageArchive,
} from "./modules/communications/native-message-archive.js";
import { GrammyNativeMessageArchive } from "./adapters/telegram/grammy-native-message-archive.adapter.js";
import { NativeMessages } from "./modules/communications/native-messages.js";
import { NativeCommunicationTransport } from "./modules/communications/native-communication-transport.js";
import {
  NATIVE_MESSAGE_COPY,
  DisabledNativeMessageCopy,
  type NativeMessageCopy,
} from "./modules/communications/native-message-copy.js";
import { GrammyNativeMessageCopy } from "./adapters/telegram/grammy-native-message-copy.adapter.js";
import { GrammyMembershipAdapter } from "./adapters/telegram/grammy-membership.adapter.js";
import { DisabledTelegramMembership } from "./modules/membership-evidence/telegram-membership.js";
import { MaterialAnnouncements } from "./modules/communications/material-announcements.js";
import {
  MATERIAL_ANNOUNCEMENT_SOURCE,
  DisabledMaterialAnnouncementSource,
} from "./modules/communications/material-announcement-source.js";
import { HttpMaterialAnnouncementsAdapter } from "./adapters/platform/http-material-announcements.adapter.js";
import type { CommunicationTransport } from "./modules/communications/communication-delivery.js";
import {
  WaitlistConfirmations,
  WAITLIST_CONFIRMATION_AUTHORIZATION,
  type WaitlistConfirmationAuthorization,
} from "./modules/communications/waitlist-confirmations.js";
import { HttpWaitlistConfirmationAdapter } from "./adapters/platform/http-waitlist-confirmation.adapter.js";
import { HttpWaitlistAuthorizationAdapter } from "./adapters/platform/http-waitlist-authorization.adapter.js";
import {
  WAITLIST_AUTHORIZATION,
  DisabledWaitlistAuthorization,
} from "./modules/communications/waitlist-authorization.js";
import { TelegramContacts } from "./modules/identity-linking/telegram-contacts.js";
import { TelegramContactsController } from "./modules/identity-linking/telegram-contacts.controller.js";
import { TelegramContactsV2Controller } from "./modules/identity-linking/telegram-contacts-v2.controller.js";
import { LinkProfiles } from "./modules/identity-linking/link-profiles.js";
import { CONTACT_MARKETING } from "./modules/identity-linking/contact-marketing.js";
import { contactMarketing } from "./application/contact-marketing.js";
import {
  TELEGRAM_CONTACT_PROFILE,
  DisabledTelegramContactProfile,
} from "./modules/identity-linking/telegram-contact-profile.js";
import { GrammyContactProfileAdapter } from "./adapters/telegram/grammy-contact-profile.adapter.js";
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
import { CourseActivation } from "./modules/course-activation/course-activation.js";
import { SourceGroupProof } from "./modules/course-activation/source-group-proof.js";
import { ACTIVATION_PLATFORM } from "./modules/course-activation/activation-ports.js";
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
import { CommunicationSequences } from "./modules/communications/communication-sequences.js";
import { MarketingEntry } from "./modules/communications/marketing-entry.js";
import { SequenceScheduler } from "./modules/communications/sequence-scheduler.js";
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
import { HttpPlatformProductSalesStateAdapter } from "./adapters/platform/http-platform-product-sales-state.adapter.js";
import { HttpSalesFunnelAdapter } from "./adapters/platform/http-sales-funnel.adapter.js";
import {
  SALES_FUNNEL_DELIVERY,
  type SalesFunnelDelivery,
} from "./modules/sales-funnel/sales-funnel-delivery.js";
import { SalesFunnelDeliveryProcessor } from "./modules/sales-funnel/sales-funnel-delivery-processor.js";
import {
  botTelegramUserIdFromToken,
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "./config/application-config.js";
import { createDatabase } from "./database/create-database.js";
import { DATABASE, type Database } from "./database/database.js";
import { DatabaseLifecycle } from "./database/database-lifecycle.js";
import { DatabaseInitialization } from "./database/database-initialization.js";
import { BotContacts } from "./modules/bot-contacts/bot-contacts.js";
import { SignInAccountLink } from "./modules/bot-sign-in/sign-in-account-link.js";
import { BotSignIn } from "./modules/bot-sign-in/bot-sign-in.js";
import { BotSignInController } from "./modules/bot-sign-in/bot-sign-in.controller.js";
import {
  CLOCK,
  systemClock,
  MONOTONIC_CLOCK,
  systemMonotonicClock,
  type Clock,
  type MonotonicClock,
} from "./shared/clock.js";
import { IdentityLinking } from "./modules/identity-linking/identity-linking.js";
import { IdentityLinkRecovery } from "./modules/identity-linking/identity-link-recovery.js";
import { IdentityLinkingController } from "./modules/identity-linking/identity-linking.controller.js";
import { InMemoryIdentityLinkingAdapter } from "./modules/identity-linking/in-memory-identity-linking.adapter.js";
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
  /** Legacy raw Nest fixtures retain their own isolated database cleanup. */
  static register(config: ApplicationConfig): DynamicModule {
    return this.compose(config);
  }

  /** Production always supplies its one lifetime-owned database. */
  static registerManaged(
    config: ApplicationConfig,
    database: Database,
    telemetry: TelegramObservability,
  ): DynamicModule {
    return this.compose(config, database, telemetry);
  }

  private static compose(
    config: ApplicationConfig,
    database?: Database,
    telemetry: TelegramObservability = disabledTelegramObservability,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        TelegramUserActivityController,
        TelegramContactsController,
        TelegramContactsV2Controller,
        BotSignInController,
        CommunityController,
        CommunicationsController,
        IdentityLinkingController,
        OperationsController,
        TelegramWebhookController,
      ],
      providers: [
        { provide: TELEGRAM_OBSERVABILITY, useValue: telemetry },
        {
          provide: WAITLIST_CONFIRMATION_AUTHORIZATION,
          inject: [TELEGRAM_OBSERVABILITY],
          useFactory: (telemetry: TelegramObservability) =>
            new HttpWaitlistConfirmationAdapter(
              config.platformAuthorAuthorizationUrl,
              config.platformAuthorAuthorizationSecret,
              fetch,
              telemetry,
            ),
        },
        {
          provide: WaitlistConfirmations,
          inject: [
            DATABASE,
            APPLICATION_CONFIG,
            CLOCK,
            WAITLIST_CONFIRMATION_AUTHORIZATION,
            COMMUNICATION_TRANSPORT,
            MONOTONIC_CLOCK,
            TELEGRAM_OBSERVABILITY,
          ],
          useFactory: (
            database: Database,
            config: ApplicationConfig,
            clock: Clock,
            authorization: WaitlistConfirmationAuthorization,
            transport: CommunicationTransport,
            monotonic: MonotonicClock,
            telemetry: TelegramObservability,
          ) =>
            new WaitlistConfirmations(
              database,
              config,
              clock,
              authorization,
              transport,
              monotonic,
              telemetry,
            ),
        },

        TelegramContacts,
        LinkProfiles,
        { provide: CONTACT_MARKETING, useValue: contactMarketing },
        {
          provide: TELEGRAM_CONTACT_PROFILE,
          useFactory: () =>
            hasText(config.botToken)
              ? new GrammyContactProfileAdapter(config.botToken)
              : new DisabledTelegramContactProfile(),
        },
        {
          provide: SIGN_IN_REPLY_ELIGIBILITY,
          useValue: signInReplyEligibility,
        },
        { provide: LINK_EFFECTS, useValue: linkEffects },
        { provide: CONTACT_EFFECTS, useValue: contactEffects },
        { provide: BLOCKED_DELIVERY, useValue: settleBlockedDelivery },
        CourseActivation,
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
        { provide: MONOTONIC_CLOCK, useValue: systemMonotonicClock },
        ...(database === undefined
          ? [
              {
                provide: DATABASE,
                inject: [APPLICATION_CONFIG],
                useFactory: (applicationConfig: ApplicationConfig) =>
                  createDatabase(applicationConfig.databaseUrl),
              },
            ]
          : [{ provide: DATABASE, useValue: database }]),
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
                readmission: {
                  replies,
                  text: applicationConfig.communityTexts.readmission,
                },
                welcome: {
                  replies,
                  text: applicationConfig.communityTexts.welcome,
                  productsMenuEnabled:
                    applicationConfig.activation?.enabled === true,
                },
                ...(applicationConfig.communityWelcomeCohort
                  ? {
                      welcomeDetails: new HttpPlatformProductSalesStateAdapter(
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
          inject: [NativeMessages, NATIVE_MESSAGE_COPY],
          useFactory: (native: NativeMessages, copy: NativeMessageCopy) =>
            config.deliveryMode === "live" && hasText(config.botToken)
              ? new NativeCommunicationTransport(
                  new GrammyCommunicationsAdapter(
                    new Api(config.botToken, { timeoutSeconds: 10 }),
                  ),
                  native,
                  copy,
                )
              : new DisabledCommunicationTransport(),
        },
        CommunicationTracking,
        Communications,
        NativeMessages,
        {
          provide: NATIVE_MESSAGE_ARCHIVE,
          useFactory: () =>
            config.deliveryMode === "live" && hasText(config.botToken)
              ? new GrammyNativeMessageArchive(
                  new Api(config.botToken, { timeoutSeconds: 10 }),
                )
              : new DisabledNativeMessageArchive(),
        },
        {
          provide: NATIVE_MESSAGE_COPY,
          useFactory: () =>
            config.deliveryMode === "live" && hasText(config.botToken)
              ? new GrammyNativeMessageCopy(
                  new Api(config.botToken, { timeoutSeconds: 10 }),
                )
              : new DisabledNativeMessageCopy(),
        },
        CommunicationSequences,
        MarketingEntry,
        SequenceScheduler,
        MaterialAnnouncements,
        {
          provide: MATERIAL_ANNOUNCEMENT_SOURCE,
          useFactory: () =>
            hasText(config.platformAuthorAuthorizationUrl) &&
            hasText(config.platformAuthorAuthorizationSecret)
              ? new HttpMaterialAnnouncementsAdapter(
                  config.platformAuthorAuthorizationUrl,
                  config.platformAuthorAuthorizationSecret,
                )
              : new DisabledMaterialAnnouncementSource(),
        },
        {
          provide: WAITLIST_AUTHORIZATION,
          useFactory: () =>
            hasText(config.platformAuthorAuthorizationUrl) &&
            hasText(config.platformAuthorAuthorizationSecret)
              ? new HttpWaitlistAuthorizationAdapter(
                  config.platformAuthorAuthorizationUrl,
                  config.platformAuthorAuthorizationSecret,
                )
              : new DisabledWaitlistAuthorization(),
        },
        {
          provide: COMMUNICATION_TRANSPORT,
          inject: [NativeMessages, NATIVE_MESSAGE_COPY],
          useFactory: (native: NativeMessages, copy: NativeMessageCopy) =>
            config.deliveryMode === "live" && hasText(config.botToken)
              ? new NativeCommunicationTransport(
                  new GrammyCommunicationsAdapter(
                    new Api(config.botToken, { timeoutSeconds: 10 }),
                  ),
                  native,
                  copy,
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
        ...(database === undefined
          ? [DatabaseLifecycle]
          : [DatabaseInitialization]),
        IdentityLinking,
        IdentityLinkRecovery,
        InMemoryIdentityLinkingAdapter,
        RuntimeMetrics,
        { provide: RUNTIME_COUNTERS, useExisting: RuntimeMetrics },
        TelegramUpdateInbox,
        TelegramUserActivity,
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
