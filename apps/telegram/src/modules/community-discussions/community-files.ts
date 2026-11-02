export const COMMUNITY_FILES = Symbol("COMMUNITY_FILES");
/** File bytes live only during transcription. Credentials never cross this boundary. */
export interface CommunityFiles {
  download(fileId: string, signal?: AbortSignal): Promise<Uint8Array>;
}
