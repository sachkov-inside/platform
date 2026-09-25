import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/index.js";
import { KinescopeVideoAuthorizationController } from "./adapters/nest/kinescope-video-authorization.controller.js";
import {
  VideoPlaybackController,
  VideoProgressController,
} from "./adapters/nest/video-playback.controller.js";
import {
  AuthoringContentCoverController,
  ContentCoverDeliveryController,
  ImportContentCoverController,
} from "./facets/content-covers/content-covers.controller.js";
import { GuideArtifactAuthoringController } from "./facets/guide-artifacts/guide-artifacts.controller.js";
import { CreateContentCollectionController } from "./features/create-content-collection/create-content-collection.controller.js";
import { CreateDraftController } from "./features/create-draft/create-draft.controller.js";
import { DeleteDraftController } from "./features/delete-draft/delete-draft.controller.js";
import { GuideArtifactReadController } from "./features/deliver-guide-artifact/deliver-guide-artifact.controller.js";
import { DeliverMaterialAssetController } from "./features/deliver-material-asset/deliver-material-asset.controller.js";
import { ImportSourceGuideController } from "./features/import-source-guide/import-source-guide.controller.js";
import { ImportSourceMaterialController } from "./features/import-source-material/import-source-material.controller.js";
import { ListAuthoringReferencesController } from "./features/list-authoring-references/list-authoring-references.controller.js";
import { ListContentCollectionsController } from "./features/list-content-collections/list-content-collections.controller.js";
import { ListMaterialsController } from "./features/list-materials/list-materials.controller.js";
import { LoadHomePinController } from "./features/load-home-pin/load-home-pin.controller.js";
import { LoadMaterialController } from "./features/load-material/load-material.controller.js";
import { LoadSeriesOrderController } from "./features/load-series-order/load-series-order.controller.js";
import { PreviewMaterialController } from "./features/preview-material/preview-material.controller.js";
import { ReadPublishedMaterialController } from "./features/read-published-material/read-published-material.controller.js";
import { ReorderSeriesController } from "./features/reorder-series/reorder-series.controller.js";
import { SaveMaterialController } from "./features/save-material/save-material.controller.js";
import { SetContentCollectionArchiveController } from "./features/set-content-collection-archive/set-content-collection-archive.controller.js";
import { SetHomePinController } from "./features/set-home-pin/set-home-pin.controller.js";
import { TransitionMaterialPublicationController } from "./features/transition-material-publication/transition-material-publication.controller.js";
import { UpdateContentCollectionController } from "./features/update-content-collection/update-content-collection.controller.js";
import { UploadMaterialAssetController } from "./features/upload-material-asset/upload-material-asset.controller.js";
import { ValidateMaterialController } from "./features/validate-material/validate-material.controller.js";
import { MaterialsModule } from "./materials.module.js";

/**
 * The HTTP surface of Materials. The API process imports it; the MCP process and the workers
 * import `MaterialsModule` alone, so they register none of these controllers.
 */
@Module({
  imports: [AccountsModule, MaterialsModule],
  controllers: [
    ReadPublishedMaterialController,
    CreateDraftController,
    ListMaterialsController,
    ListAuthoringReferencesController,
    LoadMaterialController,
    LoadSeriesOrderController,
    SaveMaterialController,
    ImportSourceMaterialController,
    ImportSourceGuideController,
    TransitionMaterialPublicationController,
    DeleteDraftController,
    ValidateMaterialController,
    PreviewMaterialController,
    ReorderSeriesController,
    LoadHomePinController,
    SetHomePinController,
    UploadMaterialAssetController,
    DeliverMaterialAssetController,
    AuthoringContentCoverController,
    ImportContentCoverController,
    ContentCoverDeliveryController,
    GuideArtifactAuthoringController,
    GuideArtifactReadController,
    ListContentCollectionsController,
    CreateContentCollectionController,
    UpdateContentCollectionController,
    SetContentCollectionArchiveController,
    VideoPlaybackController,
    VideoProgressController,
    KinescopeVideoAuthorizationController,
  ],
})
export class MaterialsHttpModule {}
