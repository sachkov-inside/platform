import type { TelegramDeliveryResult } from "../outbound/telegram-messages.js";
export interface NativeCopyCommand {
  readonly chatId: string;
  readonly sourceChatId: string;
  readonly messageIds: readonly number[];
  readonly buttons: readonly {
    readonly text: string;
    readonly url: string;
    readonly row?: number;
  }[];
}
export type NativeCopyResult =
  | Exclude<TelegramDeliveryResult, { kind: "delivered" }>
  | { readonly kind: "delivered"; readonly messageIds: readonly number[] }
  | { readonly kind: "partial"; readonly messageIds: readonly number[] };
export interface NativeMessageCopy {
  copy(command: NativeCopyCommand): Promise<NativeCopyResult>;
}
export const NATIVE_MESSAGE_COPY = Symbol("NATIVE_MESSAGE_COPY");
export class DisabledNativeMessageCopy implements NativeMessageCopy {
  copy(): Promise<NativeCopyResult> {
    return Promise.resolve({ kind: "api_rejected", providerErrorCode: 501 });
  }
}
