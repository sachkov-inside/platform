import { Module } from "@nestjs/common";

import {
  AccountDirectory,
  ACCOUNTS,
  AccountsModule,
  type Accounts,
} from "../accounts/index.js";
import {
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import { PeopleDirectory } from "./facets/people-directory/people-directory.js";
import { ReadPeopleIdentitiesController } from "./features/read-people-identities/read-people-identities.controller.js";
import { SearchPeopleController } from "./features/search-people/search-people.controller.js";

/**
 * The owner's people directory (#1721): reads composed over Accounts and Telegram Membership.
 * Nothing it answers is a source of rights. The API process imports it.
 */
@Module({
  imports: [AccountsModule, TelegramAccountLinksModule],
  controllers: [SearchPeopleController, ReadPeopleIdentitiesController],
  providers: [
    {
      provide: PeopleDirectory,
      inject: [ACCOUNTS, AccountDirectory, TelegramAccountLinks],
      useFactory: (
        accounts: Accounts,
        directory: AccountDirectory,
        telegram: TelegramAccountLinks,
      ) => new PeopleDirectory({ accounts, directory, telegram }),
    },
  ],
})
export class PeopleDirectoryHttpModule {}
