import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  AccountsModule,
  accountId,
  type Accounts,
} from "../accounts/index.js";
import { assembleCurrentAccountPermissions } from "../content-access/index.js";
import { GlossaryAuthoringController } from "./adapters/nest/glossary-authoring.controller.js";
import { assembleGlossary } from "./facets/glossary/assemble-glossary.js";
import { GLOSSARY, type Glossary } from "./facets/glossary/glossary.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [GlossaryAuthoringController],
  providers: [
    {
      provide: GLOSSARY,
      inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
      ): Glossary => {
        const permissions = assembleCurrentAccountPermissions(accounts);
        return assembleGlossary({
          prisma,
          authorPolicy: {
            canManage: (actor) =>
              permissions.hasMaterialsManage(accountId(actor)),
          },
        });
      },
    },
  ],
  exports: [GLOSSARY],
})
export class GlossaryModule {}
