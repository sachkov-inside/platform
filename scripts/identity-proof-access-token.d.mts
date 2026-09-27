export declare function readAccessTokenTtl(
  environment?: NodeJS.ProcessEnv,
): number;
export declare function accessTokenExpiredAt(
  signedInAt: number,
  environment?: NodeJS.ProcessEnv,
): number;
