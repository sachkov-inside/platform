import { TributeSources } from "./facets/tribute-sources/tribute-sources.js";
import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  WORKSHOP_ENTITLEMENTS,
  WorkshopModule,
  type WorkshopEntitlements,
} from "../workshop/index.js";
import { assembleAccessGrants } from "./facets/access-grants/assemble-access-grants.js";
import { assembleMembershipEntitlements } from "./facets/membership-entitlements/assemble-membership-entitlements.js";
import {
  ACCESS_GRANTS,
  MEMBERSHIP_ENTITLEMENTS,
} from "./membership-entitlements.tokens.js";

@Module({
  imports: [PrismaModule, AccountsModule, WorkshopModule ],
  providers: [
    { provide: TributeSources, inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: async (prisma: PrismaClientProvider, accounts: Accounts) => {
        const { TelegramAccountLinks } = await import("../telegram-membership/index.js");
        return new TributeSources({ prisma, accounts, links: new TelegramAccountLinks(prisma) });
      } },
    {
      provide: MEMBERSHIP_ENTITLEMENTS,
      inject: [PrismaClientProvider, WORKSHOP_ENTITLEMENTS],
      useFactory: async (prisma: PrismaClientProvider, workshopEntitlements: WorkshopEntitlements) => {
        const { TelegramAccountLinks } = await import("../telegram-membership/index.js");
        return assembleMembershipEntitlements({ prisma, workshopEntitlements, recipientLinks: new TelegramAccountLinks(prisma) });
      },
    },
    {
      provide: ACCESS_GRANTS,
      inject: [PrismaClientProvider, ACCOUNTS],
      // Materials' public barrel also exports its authoring composition, which consumes Membership.
      // Resolve this read-only metadata facet after module initialization, without that DI cycle.
      useFactory: async (prisma: PrismaClientProvider, accounts: Accounts) => {
        const { ContentScopeCatalog } = await import("../materials/index.js");
        const { TelegramAccountLinks } = await import("../telegram-membership/index.js");
        return assembleAccessGrants({ prisma, accounts, contentCatalog: new ContentScopeCatalog(prisma), recipientLinks: new TelegramAccountLinks(prisma) });
      },
    },
  ],
  exports: [MEMBERSHIP_ENTITLEMENTS, ACCESS_GRANTS, TributeSources],
})
export class MembershipEntitlementsModule {}
