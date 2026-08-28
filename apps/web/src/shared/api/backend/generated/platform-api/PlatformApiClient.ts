/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BaseHttpRequest } from './core/BaseHttpRequest';
import type { OpenAPIConfig } from './core/OpenAPI';
import { FetchHttpRequest } from './core/FetchHttpRequest';
import { AccountsService } from './services/AccountsService';
import { ContentLibraryService } from './services/ContentLibraryService';
import { MaterialAuthoringService } from './services/MaterialAuthoringService';
import { OperationsService } from './services/OperationsService';
import { PublishedMaterialsService } from './services/PublishedMaterialsService';
type HttpRequestConstructor = new (config: OpenAPIConfig) => BaseHttpRequest;
export class PlatformApiClient {
  public readonly accounts: AccountsService;
  public readonly contentLibrary: ContentLibraryService;
  public readonly materialAuthoring: MaterialAuthoringService;
  public readonly operations: OperationsService;
  public readonly publishedMaterials: PublishedMaterialsService;
  public readonly request: BaseHttpRequest;
  constructor(config?: Partial<OpenAPIConfig>, HttpRequest: HttpRequestConstructor = FetchHttpRequest) {
    this.request = new HttpRequest({
      BASE: config?.BASE ?? '',
      VERSION: config?.VERSION ?? '1.0.0',
      WITH_CREDENTIALS: config?.WITH_CREDENTIALS ?? false,
      CREDENTIALS: config?.CREDENTIALS ?? 'include',
      TOKEN: config?.TOKEN,
      USERNAME: config?.USERNAME,
      PASSWORD: config?.PASSWORD,
      HEADERS: config?.HEADERS,
      ENCODE_PATH: config?.ENCODE_PATH,
    });
    this.accounts = new AccountsService(this.request);
    this.contentLibrary = new ContentLibraryService(this.request);
    this.materialAuthoring = new MaterialAuthoringService(this.request);
    this.operations = new OperationsService(this.request);
    this.publishedMaterials = new PublishedMaterialsService(this.request);
  }
}
