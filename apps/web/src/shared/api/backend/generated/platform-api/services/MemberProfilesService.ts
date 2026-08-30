/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MemberProfilesService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Delete the current Account owner Profile
   * @returns any
   * @throws ApiError
   */
  public deleteMemberProfile({
    requestBody,
  }: {
    requestBody: {
      expectedVersion: number;
    },
  }): CancelablePromise<{
    deleted: boolean;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/account/profile',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
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
      bio: string | null;
      createdAt: string;
      displayName: string;
      publicProfileId: string;
      status: 'active' | 'disabled';
      updatedAt: string;
      version: number;
    };
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/account/profile',
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
      bio: string | null;
      createdAt: string;
      displayName: string;
      publicProfileId: string;
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
      bio: string | null;
      createdAt: string;
      displayName: string;
      publicProfileId: string;
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
    });
  }
  /**
   * Export only the current Account owner-authored Profile fields
   * @returns any
   * @throws ApiError
   */
  public exportMemberProfile(): CancelablePromise<{
    profile: {
      bio: string | null;
      displayName: string;
    };
    schemaVersion: 'member-profile-export.v1';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/account/profile/export',
    });
  }
  /**
   * View the accepted Profile projection as an active member
   * @returns any
   * @throws ApiError
   */
  public viewMemberProfile({
    publicProfileId,
  }: {
    publicProfileId: string,
  }): CancelablePromise<{
    profile: {
      bio: string | null;
      displayName: string;
      publicProfileId: string;
    };
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/member-profiles/{publicProfileId}',
      path: {
        'publicProfileId': publicProfileId,
      },
    });
  }
  /**
   * Report member-visible Profile text as an active member
   * @returns any
   * @throws ApiError
   */
  public reportMemberProfile({
    publicProfileId,
    requestBody,
  }: {
    publicProfileId: string,
    requestBody: {
      reason: 'unsafe_content' | 'impersonation' | 'other';
    },
  }): CancelablePromise<{
    outcome: 'recorded' | 'already_recorded';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/member-profiles/{publicProfileId}/reports',
      path: {
        'publicProfileId': publicProfileId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
