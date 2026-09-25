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
import { CONTENT_SCOPE_CATALOG, type ContentScopeCatalog } from "./ports/content-scope-catalog.js";
import { RECIPIENT_LINKS, type RecipientLinks } from "./ports/recipient-links.js";

// Materials and Telegram Membership implement the two ports in global modules of their own, so this
// Module depends on neither; a process that loads it also loads both implementations.

@Module({
  imports: [PrismaModule, AccountsModule, WorkshopModule ],
  providers: [
    { provide: TributeSources, inject: [PrismaClientProvider, ACCOUNTS, RECIPIENT_LINKS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts, links: RecipientLinks) =>
        new TributeSources({ prisma, accounts, links }) },
    {
      provide: MEMBERSHIP_ENTITLEMENTS,
      inject: [PrismaClientProvider, WORKSHOP_ENTITLEMENTS, RECIPIENT_LINKS],
      useFactory: (prisma: PrismaClientProvider, workshopEntitlements: WorkshopEntitlements, recipientLinks: RecipientLinks) =>
        assembleMembershipEntitlements({ prisma, workshopEntitlements, recipientLinks }),
    },
    {
      provide: ACCESS_GRANTS,
      inject: [PrismaClientProvider, ACCOUNTS, CONTENT_SCOPE_CATALOG, RECIPIENT_LINKS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts, contentCatalog: ContentScopeCatalog, recipientLinks: RecipientLinks) =>
        assembleAccessGrants({ prisma, accounts, contentCatalog, recipientLinks }),
    },
  ],
  exports: [MEMBERSHIP_ENTITLEMENTS, ACCESS_GRANTS, TributeSources],
})
export class MembershipEntitlementsModule {}
