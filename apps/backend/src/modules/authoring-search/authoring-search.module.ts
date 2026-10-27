import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/index.js";
import {
  MATERIAL_AUTHORING,
  MaterialsModule,
  type MaterialAuthoring,
} from "../materials/index.js";
import {
  PeopleDirectory,
  PeopleDirectoryHttpModule,
} from "../people-directory/index.js";
import { PRODUCT_AUTHORING, type ProductAuthoring } from "../products/index.js";
import { assemblePeopleSearchGroup } from "./adapters/people/people-search-group.js";
import { assembleMaterialsSearchGroup } from "./adapters/materials/materials-search-group.js";
import { assembleProductsSearchGroup } from "./adapters/products/products-search-group.js";
import {
  assembleAuthoringSearch,
  AUTHORING_SEARCH,
  type AuthoringSearch,
} from "./features/search-authoring/search-authoring.js";
import { SearchAuthoringController } from "./features/search-authoring/search-authoring.controller.js";

/**
 * The authoring search (#1720) over the groups of other Modules. This Module depends on each
 * group's owner, never the other way round. The order of the registry below is the order of the
 * groups in every answer. `PRODUCT_AUTHORING` comes from the global Product authoring composition.
 * The API process imports it.
 */
@Module({
  imports: [AccountsModule, MaterialsModule, PeopleDirectoryHttpModule],
  controllers: [SearchAuthoringController],
  providers: [
    {
      provide: AUTHORING_SEARCH,
      inject: [PeopleDirectory, PRODUCT_AUTHORING, MATERIAL_AUTHORING],
      useFactory: (
        people: PeopleDirectory,
        productAuthoring: ProductAuthoring,
        materialAuthoring: MaterialAuthoring,
      ): AuthoringSearch =>
        assembleAuthoringSearch([
          assemblePeopleSearchGroup(people),
          assembleProductsSearchGroup(productAuthoring),
          assembleMaterialsSearchGroup(materialAuthoring),
        ]),
    },
  ],
})
export class AuthoringSearchHttpModule {}
