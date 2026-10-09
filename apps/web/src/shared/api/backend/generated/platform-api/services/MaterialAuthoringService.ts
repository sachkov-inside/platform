/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RecursiveSchema1schema0 } from '../models/RecursiveSchema1schema0';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MaterialAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List Topics or Products for authoring
   * @returns any
   * @throws ApiError
   */
  public listAuthoringContentCollections({
    kind,
  }: {
    kind: 'product' | 'series' | 'topic',
  }): CancelablePromise<Array<{
    archived: boolean;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    id: string;
    introduction: {
      audience: string;
      outcome: string;
      prerequisites: string;
      scope: string;
    } | null;
    kind: 'product' | 'series' | 'topic';
    materialCount: number;
    name: string;
    page: {
      blocks: Array<({
        badge: string;
        highlights: Array<string>;
        id: string;
        kind: 'hero';
        lead: string;
      } | {
        eyebrow: string;
        id: string;
        items: Array<{
          detail: string;
          detailLabel: string;
          text: string;
          title: string;
        }>;
        kind: 'cards';
        lead: string;
        note: string;
        title: string;
      } | {
        id: string;
        kind: 'text';
        paragraphs: Array<string>;
        title: string;
      } | {
        id: string;
        items: Array<{
          text: string;
          title: string;
        }>;
        kind: 'steps';
        lead: string;
        link: string;
        title: string;
      } | {
        id: string;
        items: Array<string>;
        kind: 'list';
        text: string;
        title: string;
      } | {
        id: string;
        kind: 'trial';
        link: string;
        text: string;
        title: string;
      })>;
      card: {
        action: string;
        eyebrow: string;
        subtitle: string;
      } | null;
    } | null;
    pageRejected: boolean;
    presentation: string | null;
    slug: string;
    sourceId: string | null;
    summary: string;
    version: number;
  }>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/collections',
      query: {
        'kind': kind,
      },
    });
  }
  /**
   * Create a Topic or Product with an immutable slug
   * @returns any
   * @throws ApiError
   */
  public createAuthoringContentCollection({
    requestBody,
  }: {
    requestBody: {
      kind: 'product' | 'series' | 'topic';
      name: string;
      slug: string;
      summary: string;
    },
  }): CancelablePromise<{
    archived: boolean;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    id: string;
    introduction: {
      audience: string;
      outcome: string;
      prerequisites: string;
      scope: string;
    } | null;
    kind: 'product' | 'series' | 'topic';
    materialCount: number;
    name: string;
    page: {
      blocks: Array<({
        badge: string;
        highlights: Array<string>;
        id: string;
        kind: 'hero';
        lead: string;
      } | {
        eyebrow: string;
        id: string;
        items: Array<{
          detail: string;
          detailLabel: string;
          text: string;
          title: string;
        }>;
        kind: 'cards';
        lead: string;
        note: string;
        title: string;
      } | {
        id: string;
        kind: 'text';
        paragraphs: Array<string>;
        title: string;
      } | {
        id: string;
        items: Array<{
          text: string;
          title: string;
        }>;
        kind: 'steps';
        lead: string;
        link: string;
        title: string;
      } | {
        id: string;
        items: Array<string>;
        kind: 'list';
        text: string;
        title: string;
      } | {
        id: string;
        kind: 'trial';
        link: string;
        text: string;
        title: string;
      })>;
      card: {
        action: string;
        eyebrow: string;
        subtitle: string;
      } | null;
    } | null;
    pageRejected: boolean;
    presentation: string | null;
    slug: string;
    sourceId: string | null;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/collections',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Update Topic or Product metadata without changing its slug
   * @returns any
   * @throws ApiError
   */
  public updateAuthoringContentCollection({
    collectionId,
    requestBody,
  }: {
    collectionId: string,
    requestBody: {
      expectedVersion: number;
      introduction?: {
        audience: string;
        outcome: string;
        prerequisites: string;
        scope: string;
      };
      kind: 'product' | 'series' | 'topic';
      name: string;
      summary: string;
    },
  }): CancelablePromise<{
    archived: boolean;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    id: string;
    introduction: {
      audience: string;
      outcome: string;
      prerequisites: string;
      scope: string;
    } | null;
    kind: 'product' | 'series' | 'topic';
    materialCount: number;
    name: string;
    page: {
      blocks: Array<({
        badge: string;
        highlights: Array<string>;
        id: string;
        kind: 'hero';
        lead: string;
      } | {
        eyebrow: string;
        id: string;
        items: Array<{
          detail: string;
          detailLabel: string;
          text: string;
          title: string;
        }>;
        kind: 'cards';
        lead: string;
        note: string;
        title: string;
      } | {
        id: string;
        kind: 'text';
        paragraphs: Array<string>;
        title: string;
      } | {
        id: string;
        items: Array<{
          text: string;
          title: string;
        }>;
        kind: 'steps';
        lead: string;
        link: string;
        title: string;
      } | {
        id: string;
        items: Array<string>;
        kind: 'list';
        text: string;
        title: string;
      } | {
        id: string;
        kind: 'trial';
        link: string;
        text: string;
        title: string;
      })>;
      card: {
        action: string;
        eyebrow: string;
        subtitle: string;
      } | null;
    } | null;
    pageRejected: boolean;
    presentation: string | null;
    slug: string;
    sourceId: string | null;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/collections/{collectionId}',
      path: {
        'collectionId': collectionId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Archive or restore a Topic or Product
   * @returns any
   * @throws ApiError
   */
  public setAuthoringContentCollectionArchive({
    collectionId,
    requestBody,
  }: {
    collectionId: string,
    requestBody: {
      archived: boolean;
      expectedVersion: number;
      kind: 'product' | 'series' | 'topic';
    },
  }): CancelablePromise<{
    archived: boolean;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    id: string;
    introduction: {
      audience: string;
      outcome: string;
      prerequisites: string;
      scope: string;
    } | null;
    kind: 'product' | 'series' | 'topic';
    materialCount: number;
    name: string;
    page: {
      blocks: Array<({
        badge: string;
        highlights: Array<string>;
        id: string;
        kind: 'hero';
        lead: string;
      } | {
        eyebrow: string;
        id: string;
        items: Array<{
          detail: string;
          detailLabel: string;
          text: string;
          title: string;
        }>;
        kind: 'cards';
        lead: string;
        note: string;
        title: string;
      } | {
        id: string;
        kind: 'text';
        paragraphs: Array<string>;
        title: string;
      } | {
        id: string;
        items: Array<{
          text: string;
          title: string;
        }>;
        kind: 'steps';
        lead: string;
        link: string;
        title: string;
      } | {
        id: string;
        items: Array<string>;
        kind: 'list';
        text: string;
        title: string;
      } | {
        id: string;
        kind: 'trial';
        link: string;
        text: string;
        title: string;
      })>;
      card: {
        action: string;
        eyebrow: string;
        subtitle: string;
      } | null;
    } | null;
    pageRejected: boolean;
    presentation: string | null;
    slug: string;
    sourceId: string | null;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/collections/{collectionId}/archive',
      path: {
        'collectionId': collectionId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Remove one current author-owned cover
   * @returns any
   * @throws ApiError
   */
  public removeContentCover({
    ownerId,
    ownerKind,
    requestBody,
  }: {
    ownerId: string,
    ownerKind: 'material' | 'series' | 'topic',
    requestBody: {
      expectedCoverId: string | null;
    },
  }): CancelablePromise<{
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/authoring/content-covers/{ownerKind}/{ownerId}',
      path: {
        'ownerId': ownerId,
        'ownerKind': ownerKind,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Upload or replace one author-owned Material, Topic, or Series cover
   * @returns any
   * @throws ApiError
   */
  public uploadContentCover({
    ownerId,
    ownerKind,
    formData,
  }: {
    ownerId: string,
    ownerKind: 'material' | 'series' | 'topic',
    formData: {
      checksumSha256: string;
      declaredSize: number;
      expectedCoverId: (string | 'null');
      file: Blob;
    },
  }): CancelablePromise<{
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/content-covers/{ownerKind}/{ownerId}',
      path: {
        'ownerId': ownerId,
        'ownerKind': ownerKind,
      },
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * Read the author's Home Series selection
   * @returns any
   * @throws ApiError
   */
  public loadAuthoringHomePin(): CancelablePromise<{
    seriesId: string | null;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/home-pin',
    });
  }
  /**
   * Replace or remove the author's Home Series selection
   * @returns any
   * @throws ApiError
   */
  public setAuthoringHomePin({
    requestBody,
  }: {
    requestBody: {
      expectedVersion: number;
      seriesId: string | null;
    },
  }): CancelablePromise<{
    seriesId: string | null;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/home-pin',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Upload or replace the cover of one Material or Product owned by an authoring source
   * @returns any
   * @throws ApiError
   */
  public uploadImportedContentCover({
    ownerId,
    ownerKind,
    formData,
  }: {
    ownerId: string,
    ownerKind: 'material' | 'series',
    formData: {
      checksumSha256: string;
      declaredSize: number;
      expectedCoverId: (string | 'null');
      file: Blob;
      sourceId: string;
    },
  }): CancelablePromise<{
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/import/content-covers/{ownerKind}/{ownerId}',
      path: {
        'ownerId': ownerId,
        'ownerKind': ownerKind,
      },
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * Apply one selected source Material with optimistic version checking
   * @returns any
   * @throws ApiError
   */
  public applySourceMaterial({
    idempotencyKey,
    requestBody,
  }: {
    idempotencyKey: string,
    requestBody: {
      body: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      expectedContentVersion: number;
      materialId: string;
      metadata: {
        access: 'free' | 'closed';
        difficulty: 'basic' | 'intermediate' | 'advanced' | null;
        formatId: 'video' | 'guide' | 'note' | null;
        outcomes: Array<string>;
        seriesIds: Array<string>;
        summary: string | null;
        tagIds: Array<string>;
        title: string | null;
        topicId: string | null;
      };
      primaryVideoId: string | null;
      publicationState: 'draft' | 'published' | 'unpublished';
      source: {
        id: string;
        path: string;
        revision: string;
        showInFeed: boolean;
      };
      videoChapters?: Array<{
        start: number;
        title: string;
      }>;
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/materials/apply',
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Identify the receiving runtime before local synchronization
   * @returns any
   * @throws ApiError
   */
  public readAuthoringImportEnvironment(): CancelablePromise<{
    mode: 'development' | 'test' | 'production';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/import/materials/environment',
    });
  }
  /**
   * Reserve a stable authoring source identity without publishing
   * @returns any
   * @throws ApiError
   */
  public reserveSourceMaterial({
    requestBody,
  }: {
    requestBody: {
      source: {
        id: string;
        path: string;
        revision: string;
        showInFeed: boolean;
      };
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/materials/reserve',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Validate source content without applying any mutation
   * @returns any
   * @throws ApiError
   */
  public validateSourceContent({
    requestBody,
  }: {
    requestBody: {
      body: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      metadata: {
        access: 'free' | 'closed';
        difficulty: 'basic' | 'intermediate' | 'advanced' | null;
        formatId: 'video' | 'guide' | 'note' | null;
        outcomes: Array<string>;
        seriesIds: Array<string>;
        summary: string | null;
        tagIds: Array<string>;
        title: string | null;
        topicId: string | null;
      };
      publicationState: 'draft' | 'published' | 'unpublished';
      source: {
        id: string;
        path: string;
        revision: string;
        showInFeed: boolean;
      };
      videoChapters?: Array<{
        start: number;
        title: string;
      }>;
    },
  }): CancelablePromise<{
    valid: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/materials/validate',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Import the current practice definition against explicit source and mutation versions
   * @returns any
   * @throws ApiError
   */
  public applySourcePractice({
    idempotencyKey,
    requestBody,
  }: {
    idempotencyKey: string,
    requestBody: {
      definition: {
        allowedFreedom: string;
        businessInputs: string;
        criteria: Array<{
          acceptableEvidence: Array<string>;
          id: string;
          requirement: string;
        }>;
        expectedOutcome: string;
        schemaVersion: 1;
        title: string;
      };
      expectedContentVersion: number;
      expectedPracticeVersion: number | null;
      materialId: string;
      practiceId: string;
      provenance: {
        commit: string;
        path: string;
        repository: string;
      };
      publicationState: 'published' | 'unpublished';
      sourceReference: {
        materialSourceId: string;
        materialSourceRevision: string;
      };
    },
  }): CancelablePromise<{
    boundContentVersion: number;
    definitionDigest: string;
    materialId: string;
    practiceId: string;
    practiceVersion: number;
    publicationState: 'published' | 'unpublished';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/practices/apply',
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Validate authored practice data and inspect its current CAS version without writes
   * @returns any
   * @throws ApiError
   */
  public validateSourcePractice({
    requestBody,
  }: {
    requestBody: {
      definition: {
        allowedFreedom: string;
        businessInputs: string;
        criteria: Array<{
          acceptableEvidence: Array<string>;
          id: string;
          requirement: string;
        }>;
        expectedOutcome: string;
        schemaVersion: 1;
        title: string;
      };
      practiceId: string;
      provenance: {
        commit: string;
        path: string;
        repository: string;
      };
      publicationState: 'published' | 'unpublished';
      sourceReference: {
        materialSourceId: string;
        materialSourceRevision: string;
      };
    },
  }): CancelablePromise<{
    current: {
      boundContentVersion: number;
      definitionDigest: string;
      materialId: string;
      practiceId: string;
      practiceVersion: number;
      publicationState: 'published' | 'unpublished';
    } | null;
    valid: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/practices/validate',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Create or update one authoring-owned artifact of a source Product from its package file
   * @returns any
   * @throws ApiError
   */
  public importSourceProductArtifact({
    productId,
    formData,
  }: {
    productId: string,
    formData: {
      access: 'free' | 'closed';
      checksumSha256: string;
      declaredSize: number;
      file: Blob;
      productSourceId: string;
      purpose: string;
      sourceId: string;
      title: string;
    },
  }): CancelablePromise<{
    artifactId: string;
    outcome: 'created' | 'diverged' | 'missing' | 'unchanged' | 'updated';
    sourceId: string | null;
    title: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/products/{productId}/artifacts',
      path: {
        'productId': productId,
      },
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * reorderSourceProduct
   * @returns any
   * @throws ApiError
   */
  public reorderSourceProduct({
    requestBody,
  }: {
    requestBody: {
      chapterAssignments?: Record<string, string>;
      chapters?: Array<{
        id: string;
        name: string;
        summary: string;
      }>;
      confirmedProductRemovals: Array<string>;
      expectedOrderVersion: string;
      orderedMaterialIds: Array<any>;
      seriesId: any;
      sourceId: string;
      stepGroups?: Record<string, string>;
    },
  }): CancelablePromise<{
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/products/composition',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * reserveSourceProduct
   * @returns any
   * @throws ApiError
   */
  public reserveSourceProduct({
    requestBody,
  }: {
    requestBody: {
      name: string;
      slug: string;
      sourceId: string;
      summary: string;
    },
  }): CancelablePromise<{
    archived: boolean;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    id: string;
    introduction: {
      audience: string;
      outcome: string;
      prerequisites: string;
      scope: string;
    } | null;
    kind: 'product' | 'series' | 'topic';
    materialCount: number;
    name: string;
    page: {
      blocks: Array<({
        badge: string;
        highlights: Array<string>;
        id: string;
        kind: 'hero';
        lead: string;
      } | {
        eyebrow: string;
        id: string;
        items: Array<{
          detail: string;
          detailLabel: string;
          text: string;
          title: string;
        }>;
        kind: 'cards';
        lead: string;
        note: string;
        title: string;
      } | {
        id: string;
        kind: 'text';
        paragraphs: Array<string>;
        title: string;
      } | {
        id: string;
        items: Array<{
          text: string;
          title: string;
        }>;
        kind: 'steps';
        lead: string;
        link: string;
        title: string;
      } | {
        id: string;
        items: Array<string>;
        kind: 'list';
        text: string;
        title: string;
      } | {
        id: string;
        kind: 'trial';
        link: string;
        text: string;
        title: string;
      })>;
      card: {
        action: string;
        eyebrow: string;
        subtitle: string;
      } | null;
    } | null;
    pageRejected: boolean;
    presentation: string | null;
    slug: string;
    sourceId: string | null;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/products/reserve',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * updateSourceProduct
   * @returns any
   * @throws ApiError
   */
  public updateSourceProduct({
    requestBody,
  }: {
    requestBody: {
      collectionId: any;
      expectedVersion: number;
      introduction?: {
        audience: string;
        outcome: string;
        prerequisites: string;
        scope: string;
      };
      name: string;
      source: {
        page: {
          blocks: Array<({
            badge: string;
            highlights: Array<string>;
            id: string;
            kind: 'hero';
            lead: string;
          } | {
            eyebrow: string;
            id: string;
            items: Array<{
              detail: string;
              detailLabel: string;
              text: string;
              title: string;
            }>;
            kind: 'cards';
            lead: string;
            note: string;
            title: string;
          } | {
            id: string;
            kind: 'text';
            paragraphs: Array<string>;
            title: string;
          } | {
            id: string;
            items: Array<{
              text: string;
              title: string;
            }>;
            kind: 'steps';
            lead: string;
            link: string;
            title: string;
          } | {
            id: string;
            items: Array<string>;
            kind: 'list';
            text: string;
            title: string;
          } | {
            id: string;
            kind: 'trial';
            link: string;
            text: string;
            title: string;
          })>;
          card: {
            action: string;
            eyebrow: string;
            subtitle: string;
          } | null;
        } | null;
        presentation: 'default' | 'ai-first-process' | 'ai-engineering-course';
        slug: string;
      };
      sourceId: string;
      summary: string;
    },
  }): CancelablePromise<{
    archived: boolean;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    id: string;
    introduction: {
      audience: string;
      outcome: string;
      prerequisites: string;
      scope: string;
    } | null;
    kind: 'product' | 'series' | 'topic';
    materialCount: number;
    name: string;
    page: {
      blocks: Array<({
        badge: string;
        highlights: Array<string>;
        id: string;
        kind: 'hero';
        lead: string;
      } | {
        eyebrow: string;
        id: string;
        items: Array<{
          detail: string;
          detailLabel: string;
          text: string;
          title: string;
        }>;
        kind: 'cards';
        lead: string;
        note: string;
        title: string;
      } | {
        id: string;
        kind: 'text';
        paragraphs: Array<string>;
        title: string;
      } | {
        id: string;
        items: Array<{
          text: string;
          title: string;
        }>;
        kind: 'steps';
        lead: string;
        link: string;
        title: string;
      } | {
        id: string;
        items: Array<string>;
        kind: 'list';
        text: string;
        title: string;
      } | {
        id: string;
        kind: 'trial';
        link: string;
        text: string;
        title: string;
      })>;
      card: {
        action: string;
        eyebrow: string;
        subtitle: string;
      } | null;
    } | null;
    pageRejected: boolean;
    presentation: string | null;
    slug: string;
    sourceId: string | null;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/products/update',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * validateSourceProduct
   * @returns any
   * @throws ApiError
   */
  public validateSourceProduct({
    requestBody,
  }: {
    requestBody: {
      introduction?: {
        audience: string;
        outcome: string;
        prerequisites: string;
        scope: string;
      };
      source: {
        page: {
          blocks: Array<({
            badge: string;
            highlights: Array<string>;
            id: string;
            kind: 'hero';
            lead: string;
          } | {
            eyebrow: string;
            id: string;
            items: Array<{
              detail: string;
              detailLabel: string;
              text: string;
              title: string;
            }>;
            kind: 'cards';
            lead: string;
            note: string;
            title: string;
          } | {
            id: string;
            kind: 'text';
            paragraphs: Array<string>;
            title: string;
          } | {
            id: string;
            items: Array<{
              text: string;
              title: string;
            }>;
            kind: 'steps';
            lead: string;
            link: string;
            title: string;
          } | {
            id: string;
            items: Array<string>;
            kind: 'list';
            text: string;
            title: string;
          } | {
            id: string;
            kind: 'trial';
            link: string;
            text: string;
            title: string;
          })>;
          card: {
            action: string;
            eyebrow: string;
            subtitle: string;
          } | null;
        } | null;
        presentation: 'default' | 'ai-first-process' | 'ai-engineering-course';
        slug?: string;
      };
      sourceId: string;
    },
  }): CancelablePromise<{
    valid: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/products/validate',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * List the complete Material authoring corpus
   * @returns any
   * @throws ApiError
   */
  public listAuthoringMaterials({
    search,
    publicationState,
    page,
  }: {
    search?: string,
    publicationState?: 'draft' | 'published' | 'unpublished',
    page?: number,
  }): CancelablePromise<{
    items: Array<{
      canDelete: boolean;
      contentVersion: number;
      format: {
        id: 'video' | 'guide' | 'note';
        name: string;
      } | null;
      materialId: string;
      publicationState: 'draft' | 'published' | 'unpublished';
      title: string | null;
      topic: {
        id: string;
        name: string;
      } | null;
      updatedAt: string;
    }>;
    page: number;
    pageSize: 20;
    totalItems: number;
    totalPages: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials',
      query: {
        'search': search,
        'publicationState': publicationState,
        'page': page,
      },
    });
  }
  /**
   * Create one current Material draft
   * @returns any
   * @throws ApiError
   */
  public createMaterialDraft({
    idempotencyKey,
    requestBody,
  }: {
    idempotencyKey: string,
    requestBody: {
      body: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      metadata: {
        access: 'free' | 'closed';
        difficulty: 'basic' | 'intermediate' | 'advanced' | null;
        formatId: 'video' | 'guide' | 'note' | null;
        outcomes: Array<string>;
        seriesIds: Array<string>;
        summary: string | null;
        tagIds: Array<string>;
        title: string | null;
        topicId: string | null;
      };
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/materials',
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Delete a never-published Material draft
   * @returns any
   * @throws ApiError
   */
  public deleteMaterialDraft({
    idempotencyKey,
    materialId,
    requestBody,
  }: {
    idempotencyKey: string,
    materialId: string,
    requestBody: {
      deleteVideoId: string | null;
      expectedContentVersion: number;
    },
  }): CancelablePromise<{
    materialId: string;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/authoring/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Load the current saved Material
   * @returns any
   * @throws ApiError
   */
  public loadCurrentMaterial({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    body: {
      doc: Record<string, any>;
      schemaVersion: 1;
    };
    contentVersion: number;
    cover: {
      coverId: string;
      renditions: Array<{
        height: number;
        width: number;
      }>;
    } | null;
    firstPublishedAt: string | null;
    latestVideoDeletion: {
      durationSeconds?: number;
      failureCode?: string;
      origin: 'external_attachment' | 'platform_upload';
      state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
      title: string;
      videoId: string;
    } | null;
    materialId: string;
    metadata: {
      access: 'free' | 'closed';
      difficulty: 'basic' | 'intermediate' | 'advanced' | null;
      formatId: 'video' | 'guide' | 'note' | null;
      outcomes: Array<string>;
      seriesMemberships: Array<{
        ordinal: number;
        seriesId: string;
      }>;
      slug: string | null;
      summary: string | null;
      tagIds: Array<string>;
      title: string | null;
      topicId: string | null;
    };
    primaryVideo: {
      durationSeconds?: number;
      failureCode?: string;
      origin: 'external_attachment' | 'platform_upload';
      state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
      title: string;
      videoId: string;
    } | null;
    primaryVideoId: string | null;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
    source?: {
      id: string;
      path: string;
      revision: string;
      showInFeed: boolean;
    };
    unselectedVideoUpload: {
      durationSeconds?: number;
      failureCode?: string;
      origin: 'external_attachment' | 'platform_upload';
      state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
      title: string;
      videoId: string;
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Atomically Save the complete current Material state
   * Source-owned Materials return forbidden. Incompatible Product membership changes return invalid_reference with material_source_mismatch at /metadata/seriesIds/<index>; removing a membership uses /metadata/seriesIds.
   * @returns any
   * @throws ApiError
   */
  public saveCurrentMaterial({
    idempotencyKey,
    materialId,
    requestBody,
  }: {
    idempotencyKey: string,
    materialId: string,
    requestBody: {
      body: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      confirmedProductRemovals?: Array<string>;
      deleteVideoId: string | null;
      detachVideoIds: Array<string>;
      expectedContentVersion: number;
      metadata: {
        access: 'free' | 'closed';
        difficulty: 'basic' | 'intermediate' | 'advanced' | null;
        formatId: 'video' | 'guide' | 'note' | null;
        outcomes: Array<string>;
        seriesIds: Array<string>;
        summary: string | null;
        tagIds: Array<string>;
        title: string | null;
        topicId: string | null;
      };
      primaryVideoId: string | null;
      publicationState: 'draft' | 'published' | 'unpublished';
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Upload and finalize an immutable Material asset
   * @returns any
   * @throws ApiError
   */
  public uploadMaterialAsset({
    idempotencyKey,
    materialId,
    formData,
  }: {
    idempotencyKey: string,
    materialId: string,
    formData: {
      checksumSha256: string;
      declaredSize: number;
      file: Blob;
      kind: 'file' | 'image';
    },
  }): CancelablePromise<{
    assetId: string;
    contentType: string;
    filename: string;
    height?: number;
    kind: 'file' | 'image';
    size: number;
    state: 'ready';
    variants?: Array<{
      height: number;
      width: number;
    }>;
    width?: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/materials/{materialId}/assets',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * Render the current saved Material
   * @returns any
   * @throws ApiError
   */
  public previewCurrentMaterial({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    body: {
      blocks: Array<RecursiveSchema1schema0>;
      schemaVersion: 1;
    };
    cacheScope: 'private-no-store';
    contentVersion: number;
    materialId: string;
    metadata: {
      access: 'free' | 'closed';
      difficulty: 'basic' | 'intermediate' | 'advanced' | null;
      formatId: 'video' | 'guide' | 'note' | null;
      outcomes: Array<string>;
      seriesMemberships: Array<{
        ordinal: number;
        seriesId: string;
      }>;
      slug: string | null;
      summary: string | null;
      tagIds: Array<string>;
      title: string | null;
      topicId: string | null;
    };
    publicationState: 'draft' | 'published' | 'unpublished';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/{materialId}/preview',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Publish or unpublish the current Material without resending its content
   * @returns any
   * @throws ApiError
   */
  public transitionMaterialPublication({
    idempotencyKey,
    materialId,
    requestBody,
  }: {
    idempotencyKey: string,
    materialId: string,
    requestBody: {
      expectedContentVersion: number;
      publicationState: 'published' | 'unpublished';
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/authoring/materials/{materialId}/publication',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Validate the current Material for publication
   * @returns any
   * @throws ApiError
   */
  public validateCurrentMaterial({
    expectedContentVersion,
    materialId,
  }: {
    expectedContentVersion: number,
    materialId: string,
  }): CancelablePromise<{
    contentVersion: number;
    extraction: {
      hasModeVariants: boolean;
      headings: Array<{
        level: (2 | 3 | 4);
        text: string;
      }>;
      plainText: string;
      resources: Array<({
        alt: string;
        assetId: string;
        caption?: string;
        kind: 'image';
      } | {
        assetId: string;
        kind: 'file';
        label: string;
      })>;
    };
    materialId: string;
    projectionDigest: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/{materialId}/validation',
      path: {
        'materialId': materialId,
      },
      query: {
        'expectedContentVersion': expectedContentVersion,
      },
    });
  }
  /**
   * List the reference values available to a Material author
   * @returns any
   * @throws ApiError
   */
  public listMaterialAuthoringReferences(): CancelablePromise<{
    formats: Array<{
      archived: boolean;
      id: 'video' | 'guide' | 'note';
      name: string;
    }>;
    series: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
    tags: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
    topics: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/references',
    });
  }
  /**
   * List every active artifact an author may reuse in another Product
   * @returns any
   * @throws ApiError
   */
  public listReusableProductArtifacts(): CancelablePromise<{
    artifacts: Array<{
      access: 'free' | 'closed';
      archived: boolean;
      artifactId: string;
      content: ({
        contentType: string;
        filename: string;
        kind: 'file';
        size: number;
      } | {
        externalUrl: string;
        kind: 'link';
      });
      materialIds: Array<string>;
      origin: 'authoring' | 'platform';
      productIds: Array<string>;
      purpose: string;
      sourceId: string | null;
      title: string;
      updatedAt: string;
      version: number;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/product-artifacts',
    });
  }
  /**
   * Remove one Product Artifact that no Product or Material still references
   * @returns any
   * @throws ApiError
   */
  public removeProductArtifact({
    artifactId,
  }: {
    artifactId: string,
  }): CancelablePromise<{
    artifactId: string;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/authoring/product-artifacts/{artifactId}',
      path: {
        'artifactId': artifactId,
      },
    });
  }
  /**
   * Change the name, purpose or access class of one Product Artifact
   * @returns any
   * @throws ApiError
   */
  public updateProductArtifact({
    artifactId,
    requestBody,
  }: {
    artifactId: string,
    requestBody: {
      access: 'free' | 'closed';
      purpose: string;
      title: string;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/authoring/product-artifacts/{artifactId}',
      path: {
        'artifactId': artifactId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Archive one Product Artifact or return it from the archive
   * @returns any
   * @throws ApiError
   */
  public setProductArtifactArchived({
    artifactId,
    requestBody,
  }: {
    artifactId: string,
    requestBody: {
      archived: boolean;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/product-artifacts/{artifactId}/archive',
      path: {
        'artifactId': artifactId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Replace the artifact content with a new external address version
   * @returns any
   * @throws ApiError
   */
  public replaceProductArtifactLink({
    artifactId,
    requestBody,
  }: {
    artifactId: string,
    requestBody: {
      externalUrl: string;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/product-artifacts/{artifactId}/link',
      path: {
        'artifactId': artifactId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Set the Materials one artifact belongs with inside its Products
   * @returns any
   * @throws ApiError
   */
  public setProductArtifactMaterials({
    artifactId,
    requestBody,
  }: {
    artifactId: string,
    requestBody: {
      materialIds: Array<string>;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/product-artifacts/{artifactId}/materials',
      path: {
        'artifactId': artifactId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Set the Products that reuse one artifact without copying it
   * @returns any
   * @throws ApiError
   */
  public setProductArtifactProducts({
    artifactId,
    requestBody,
  }: {
    artifactId: string,
    requestBody: {
      productIds: Array<string>;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/product-artifacts/{artifactId}/products',
      path: {
        'artifactId': artifactId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Replace the artifact content with a new uploaded file version
   * @returns any
   * @throws ApiError
   */
  public replaceProductArtifactFile({
    formData,
  }: {
    formData: {
      artifactId: string;
      checksumSha256: string;
      declaredSize: number;
      file: Blob;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/product-artifacts/file',
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * Create one Product Artifact from an uploaded file
   * @returns any
   * @throws ApiError
   */
  public createProductArtifactFromFile({
    formData,
  }: {
    formData: {
      access: 'free' | 'closed';
      checksumSha256: string;
      declaredSize: number;
      file: Blob;
      productId: string;
      purpose: string;
      title: string;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/product-artifacts/files',
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * Create one Product Artifact that points at an explicit external address
   * @returns any
   * @throws ApiError
   */
  public createProductArtifactFromLink({
    requestBody,
  }: {
    requestBody: {
      access: 'free' | 'closed';
      externalUrl: string;
      productId: string;
      purpose: string;
      title: string;
    },
  }): CancelablePromise<{
    access: 'free' | 'closed';
    archived: boolean;
    artifactId: string;
    content: ({
      contentType: string;
      filename: string;
      kind: 'file';
      size: number;
    } | {
      externalUrl: string;
      kind: 'link';
    });
    materialIds: Array<string>;
    origin: 'authoring' | 'platform';
    productIds: Array<string>;
    purpose: string;
    sourceId: string | null;
    title: string;
    updatedAt: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/product-artifacts/links',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * List the artifacts placed in one Product
   * @returns any
   * @throws ApiError
   */
  public listAuthoringProductArtifacts({
    productId,
  }: {
    productId: string,
  }): CancelablePromise<{
    artifacts: Array<{
      access: 'free' | 'closed';
      archived: boolean;
      artifactId: string;
      content: ({
        contentType: string;
        filename: string;
        kind: 'file';
        size: number;
      } | {
        externalUrl: string;
        kind: 'link';
      });
      materialIds: Array<string>;
      origin: 'authoring' | 'platform';
      productIds: Array<string>;
      purpose: string;
      sourceId: string | null;
      title: string;
      updatedAt: string;
      version: number;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/products/{productId}/artifacts',
      path: {
        'productId': productId,
      },
    });
  }
  /**
   * Load the current Material order for a Product
   * @returns any
   * @throws ApiError
   */
  public loadAuthoringProductOrder({
    productId,
  }: {
    productId: string,
  }): CancelablePromise<{
    archived: boolean;
    chapters: Array<{
      id: string;
      name: string;
      ordinal: number;
      summary: string;
    }>;
    items: Array<{
      chapterId: string | null;
      materialId: string;
      ordinal: number;
      publicationState: 'draft' | 'published' | 'unpublished';
      stepGroup: string | null;
      title: string | null;
    }>;
    name: string;
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/products/{productId}/order',
      path: {
        'productId': productId,
      },
    });
  }
  /**
   * Replace the Material order for a Product
   * @returns any
   * @throws ApiError
   */
  public reorderAuthoringProduct({
    productId,
    requestBody,
  }: {
    productId: string,
    requestBody: {
      chapterAssignments?: Record<string, string>;
      chapters?: Array<{
        id: string;
        name: string;
        summary: string;
      }>;
      confirmedProductRemovals?: Array<string>;
      expectedOrderVersion: string;
      orderedMaterialIds: Array<string>;
      stepGroups?: Record<string, string>;
    },
  }): CancelablePromise<{
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/products/{productId}/order',
      path: {
        'productId': productId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * @deprecated
   * Load the current Material order for a Series
   * @returns any
   * @throws ApiError
   */
  public loadAuthoringSeriesOrder({
    seriesId,
  }: {
    seriesId: string,
  }): CancelablePromise<{
    archived: boolean;
    chapters: Array<{
      id: string;
      name: string;
      ordinal: number;
      summary: string;
    }>;
    items: Array<{
      chapterId: string | null;
      materialId: string;
      ordinal: number;
      publicationState: 'draft' | 'published' | 'unpublished';
      stepGroup: string | null;
      title: string | null;
    }>;
    name: string;
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/series/{seriesId}/order',
      path: {
        'seriesId': seriesId,
      },
    });
  }
  /**
   * @deprecated
   * Replace the Material order for a Series
   * @returns any
   * @throws ApiError
   */
  public reorderAuthoringSeries({
    seriesId,
    requestBody,
  }: {
    seriesId: string,
    requestBody: {
      chapterAssignments?: Record<string, string>;
      chapters?: Array<{
        id: string;
        name: string;
        summary: string;
      }>;
      confirmedProductRemovals?: Array<string>;
      expectedOrderVersion: string;
      orderedMaterialIds: Array<string>;
      stepGroups?: Record<string, string>;
    },
  }): CancelablePromise<{
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/series/{seriesId}/order',
      path: {
        'seriesId': seriesId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
