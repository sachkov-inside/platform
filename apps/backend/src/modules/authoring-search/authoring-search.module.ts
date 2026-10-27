import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/index.js";
import {
  MATERIAL_AUTHORING,
  MaterialsModule,
  type MaterialAuthoring,
} from "../materials/index.js";
import { assembleMaterialsSearchGroups } from "./adapters/materials/materials-search-groups.js";
import {
  assembleAuthoringSearch,
  AUTHORING_SEARCH,
  type AuthoringSearch,
} from "./features/search-authoring/search-authoring.js";
import { SearchAuthoringController } from "./features/search-authoring/search-authoring.controller.js";

/**
 * The authoring search (#1720) over the groups of other Modules. This Module depends on each
 * group's owner, never the other way round. The order of the registry below is the order of the
 * groups in every answer. The API process imports it.
 */
@Module({
  imports: [AccountsModule, MaterialsModule],
  controllers: [SearchAuthoringController],
  providers: [
    {
      provide: AUTHORING_SEARCH,
      inject: [MATERIAL_AUTHORING],
      useFactory: (materialAuthoring: MaterialAuthoring): AuthoringSearch =>
        assembleAuthoringSearch([
          ...assembleMaterialsSearchGroups(materialAuthoring),
        ]),
    },
  ],
})
export class AuthoringSearchHttpModule {}
