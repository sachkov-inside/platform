import { TributeSources } from "./facets/tribute-sources/tribute-sources.js";
import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { assembleAccessGrants } from "./facets/access-grants/assemble-access-grants.js";
import { assembleAccountRights } from "./facets/account-rights/assemble-account-rights.js";
import { ACCESS_GRANTS, ACCOUNT_RIGHTS } from "./account-rights.tokens.js";
import {
  COVERAGE_CATALOG,
  type CoverageCatalog,
} from "./ports/coverage-catalog.js";
import {
  RECIPIENT_LINKS,
  type RecipientLinks,
} from "./ports/recipient-links.js";

// Materials and Telegram Membership implement the two ports in global modules of their own, so this
// Module depends on neither; a process that loads it also loads both implementations.

@Module({
  imports: [PrismaModule, AccountsModule],
  providers: [
    {
      provide: TributeSources,
      inject: [PrismaClientProvider, ACCOUNTS, RECIPIENT_LINKS],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        links: RecipientLinks,
      ) => new TributeSources({ prisma, accounts, links }),
    },
    {
      provide: ACCOUNT_RIGHTS,
      inject: [PrismaClientProvider, RECIPIENT_LINKS],
      useFactory: (
        prisma: PrismaClientProvider,
        recipientLinks: RecipientLinks,
      ) =>
        assembleAccountRights({
          prisma,
          recipientLinks,
        }),
    },
    {
      provide: ACCESS_GRANTS,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        COVERAGE_CATALOG,
        RECIPIENT_LINKS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        contentCatalog: CoverageCatalog,
        recipientLinks: RecipientLinks,
      ) =>
        assembleAccessGrants({
          prisma,
          accounts,
          contentCatalog,
          recipientLinks,
        }),
    },
  ],
  exports: [ACCOUNT_RIGHTS, ACCESS_GRANTS, TributeSources],
})
export class AccountRightsModule {}
