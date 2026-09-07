/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class PersonalHomeService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read at most six accessible unfinished Materials of the current Account
   * @returns any
   * @throws ApiError
   */
  public getContinueMaterials(): CancelablePromise<Array<{
    lastOpenedAt: string;
    material: {
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: 'video' | 'guide' | 'note';
        name: string;
        slug: 'video' | 'guide' | 'note';
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
        stepGroup?: string | null;
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    };
    resume: ({
      kind: 'start';
    } | {
      kind: 'position';
      positionSeconds: number;
    } | {
      kind: 'reached-end';
    });
  }>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/reading-activity/continue',
    });
  }
  /**
   * Read the latest unfinished Series and partially watched Video of the current Account
   * @returns any
   * @throws ApiError
   */
  public getLearningHome(): CancelablePromise<{
    series: {
      collection: {
        count: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        id: string;
        name: string;
        previewItems: Array<{
          access: 'free' | 'membership' | 'workshop';
          availability: 'available' | 'locked' | 'unavailable';
          contentVersion: number;
          cover: {
            coverId: string;
            renditions: Array<{
              height: number;
              width: number;
            }>;
          } | null;
          format: {
            id: 'video' | 'guide' | 'note';
            name: string;
            slug: 'video' | 'guide' | 'note';
          };
          materialId: string;
          primaryVideoDurationSeconds?: number;
          primaryVideoId: string | null;
          publishedAt: string;
          seriesMemberships: Array<{
            ordinal: number;
            series: {
              id: string;
              name: string;
              slug: string;
            };
            stepGroup?: string | null;
          }>;
          slug: string;
          summary: string;
          tags: Array<{
            id: string;
            name: string;
          }>;
          title: string;
          topic: {
            id: string;
            name: string;
            slug: string;
          };
        }>;
        slug: string;
        summary: string | null;
      };
      continuation: {
        materialSlug: string;
        resume: ({
          kind: 'start';
        } | {
          kind: 'position';
          positionSeconds: number;
        } | {
          kind: 'reached-end';
        });
      } | null;
      read: number;
      total: number;
    } | null;
    video: {
      lastOpenedAt: string;
      material: {
        access: 'free' | 'membership' | 'workshop';
        availability: 'available' | 'locked' | 'unavailable';
        contentVersion: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        format: {
          id: 'video' | 'guide' | 'note';
          name: string;
          slug: 'video' | 'guide' | 'note';
        };
        materialId: string;
        primaryVideoDurationSeconds?: number;
        primaryVideoId: string | null;
        publishedAt: string;
        seriesMemberships: Array<{
          ordinal: number;
          series: {
            id: string;
            name: string;
            slug: string;
          };
          stepGroup?: string | null;
        }>;
        slug: string;
        summary: string;
        tags: Array<{
          id: string;
          name: string;
        }>;
        title: string;
        topic: {
          id: string;
          name: string;
          slug: string;
        };
      };
      resume: ({
        kind: 'start';
      } | {
        kind: 'position';
        positionSeconds: number;
      } | {
        kind: 'reached-end';
      });
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/reading-activity/learning-home',
    });
  }
  /**
   * Record a visible, successfully opened Material for the current Account
   * @returns any
   * @throws ApiError
   */
  public recordMaterialOpen({
    requestBody,
  }: {
    requestBody: {
      commandId: string;
      contentVersion: number;
      materialId: string;
    },
  }): CancelablePromise<{
    openedAt: string;
    replayed: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/reading-activity/opens',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read saved progress and the next accessible Material in a published Series
   * @returns any
   * @throws ApiError
   */
  public getSeriesContinuation({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<{
    collection: {
      count: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      previewItems: Array<{
        access: 'free' | 'membership' | 'workshop';
        availability: 'available' | 'locked' | 'unavailable';
        contentVersion: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        format: {
          id: 'video' | 'guide' | 'note';
          name: string;
          slug: 'video' | 'guide' | 'note';
        };
        materialId: string;
        primaryVideoDurationSeconds?: number;
        primaryVideoId: string | null;
        publishedAt: string;
        seriesMemberships: Array<{
          ordinal: number;
          series: {
            id: string;
            name: string;
            slug: string;
          };
          stepGroup?: string | null;
        }>;
        slug: string;
        summary: string;
        tags: Array<{
          id: string;
          name: string;
        }>;
        title: string;
        topic: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string | null;
    };
    continuation: {
      materialSlug: string;
      resume: ({
        kind: 'start';
      } | {
        kind: 'position';
        positionSeconds: number;
      } | {
        kind: 'reached-end';
      });
    } | null;
    read: number;
    total: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/reading-activity/series-continuation/{slug}',
      path: {
        'slug': slug,
      },
    });
  }
}
