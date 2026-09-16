/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MemberProfilesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the current Account owner Profile state
   * @returns any
   * @throws ApiError
   */
  public readPrivateAccountProfile(): CancelablePromise<({
    kind: 'missing';
  } | {
    kind: 'profile';
    profile: {
      avatar: {
        avatarId: string;
      } | null;
      bio: string | null;
      createdAt: string;
      displayName: string;
      status: 'active' | 'disabled';
      updatedAt: string;
      version: number;
    };
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/account/profile',
      errors: {
        403: `The terms of use in force are not accepted yet`,
      },
    });
  }
  /**
   * Create the current Account owner Profile
   * @returns any
   * @throws ApiError
   */
  public createMemberProfile({
    requestBody,
  }: {
    requestBody: {
      bio?: string | null;
      displayName: string;
    },
  }): CancelablePromise<{
    profile: {
      avatar: {
        avatarId: string;
      } | null;
      bio: string | null;
      createdAt: string;
      displayName: string;
      status: 'active' | 'disabled';
      updatedAt: string;
      version: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/account/profile',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        403: `The terms of use in force are not accepted yet`,
      },
    });
  }
  /**
   * Update the current Account owner Profile
   * @returns any
   * @throws ApiError
   */
  public updateMemberProfile({
    requestBody,
  }: {
    requestBody: {
      bio?: string | null;
      displayName: string;
      expectedVersion: number;
    },
  }): CancelablePromise<{
    profile: {
      avatar: {
        avatarId: string;
      } | null;
      bio: string | null;
      createdAt: string;
      displayName: string;
      status: 'active' | 'disabled';
      updatedAt: string;
      version: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/account/profile',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        403: `The terms of use in force are not accepted yet`,
      },
    });
  }
  /**
   * Remove the current Account owner Profile avatar
   * @returns any
   * @throws ApiError
   */
  public removeProfileAvatar({
    requestBody,
  }: {
    requestBody: {
      expectedVersion: number;
    },
  }): CancelablePromise<{
    profile: {
      avatar: {
        avatarId: string;
      } | null;
      bio: string | null;
      createdAt: string;
      displayName: string;
      status: 'active' | 'disabled';
      updatedAt: string;
      version: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/account/profile/avatar',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        403: `The terms of use in force are not accepted yet`,
      },
    });
  }
  /**
   * Crop and replace the current Account owner Profile avatar
   * @returns any
   * @throws ApiError
   */
  public uploadProfileAvatar({
    formData,
  }: {
    formData: {
      checksumSha256: string;
      /**
       * JSON normalized crop with centerX, centerY, and zoom
       */
      crop: string;
      declaredSize: number;
      expectedVersion: number;
      file: Blob;
    },
  }): CancelablePromise<{
    profile: {
      avatar: {
        avatarId: string;
      } | null;
      bio: string | null;
      createdAt: string;
      displayName: string;
      status: 'active' | 'disabled';
      updatedAt: string;
      version: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/account/profile/avatar',
      formData: formData,
      mediaType: 'multipart/form-data',
      errors: {
        403: `The terms of use in force are not accepted yet`,
      },
    });
  }
  /**
   * Read a current avatar rendition of the current Account owner Profile
   * @returns void
   * @throws ApiError
   */
  public readOwnProfileAvatar({
    size,
    avatarId,
  }: {
    size: 160 | 320 | 640,
    avatarId: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/account/profile/avatar/{avatarId}/{size}',
      path: {
        'size': size,
        'avatarId': avatarId,
      },
      errors: {
        302: `Short-lived protected avatar redirect`,
        403: `The terms of use in force are not accepted yet`,
      },
    });
  }
}
