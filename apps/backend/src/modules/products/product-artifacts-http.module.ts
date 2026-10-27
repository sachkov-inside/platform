import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/index.js";
import { ProductArtifactsModule } from "./product-artifacts.module.js";
import { ProductArtifactAuthoringController } from "./facets/product-artifacts/product-artifacts.controller.js";
import { ProductArtifactReadController } from "./features/deliver-product-artifact/deliver-product-artifact.controller.js";
@Module({
  imports: [AccountsModule, ProductArtifactsModule],
  controllers: [
    ProductArtifactAuthoringController,
    ProductArtifactReadController,
  ],
})
export class ProductArtifactsHttpModule {}
