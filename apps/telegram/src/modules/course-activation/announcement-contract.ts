import {
  activationValidator,
  type ACTIVATION_VERSION,
} from "./activation-contract.js";
export type AnnouncementResponse =
  | {
      readonly ok: true;
      readonly value: {
        readonly contractVersion: typeof ACTIVATION_VERSION;
        readonly rule: {
          readonly id: string;
          readonly revision: number;
          readonly sourceRef: string;
          readonly productId: string;
        };
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_input" | "policy_paused" | "unavailable";
      };
    };
export const validAnnouncementResponse =
  activationValidator<AnnouncementResponse>("announcementResponse");
