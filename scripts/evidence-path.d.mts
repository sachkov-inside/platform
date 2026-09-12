export declare function evidenceDirectory(
  issueFolder: string,
  environment?: NodeJS.ProcessEnv,
): string;
export declare function evidencePath(
  issueFolder: string,
  fileName: string,
  environment?: NodeJS.ProcessEnv,
): string;
export declare function prepareEvidenceDirectory(
  issueFolder: string,
  environment?: NodeJS.ProcessEnv,
): Promise<string>;
