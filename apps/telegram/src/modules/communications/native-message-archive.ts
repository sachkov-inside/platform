import type { NativeMessageSource } from "./native-message-source.js";
import type { NativeCopyResult } from "./native-message-copy.js";
export interface NativeArchiveCommand {
  readonly chatId: string;
  readonly sources: readonly NativeMessageSource[];
}
export type NativeArchiveResult =
  | Exclude<NativeCopyResult, { kind: "delivered" }>
  | {
      readonly kind: "delivered";
      readonly messageIds: readonly number[];
      readonly sources: readonly NativeMessageSource[];
    };
export interface NativeMessageArchive {
  archive(command: NativeArchiveCommand): Promise<NativeArchiveResult>;
}
export const NATIVE_MESSAGE_ARCHIVE = Symbol("NATIVE_MESSAGE_ARCHIVE");
export class DisabledNativeMessageArchive implements NativeMessageArchive {
  archive(): Promise<NativeArchiveResult> {
    return Promise.resolve({ kind: "api_rejected", providerErrorCode: 501 });
  }
}
