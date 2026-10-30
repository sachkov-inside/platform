import type { NativeMessageSource } from "./native-message-source.js";

export type NativeCaptureKind = "template" | "admin";
export interface NativeCaptureGuard {
  readonly archiveRef: string;
  readonly contextHash: string;
  readonly kind: NativeCaptureKind;
}
export interface NativeMessageInput {
  readonly botIdentity: string;
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly text?: string;
  readonly nativeSource?: NativeMessageSource;
  readonly nativeCapture?: NativeCaptureGuard;
}
